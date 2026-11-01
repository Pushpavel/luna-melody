import type { PianoNote } from "./PianoRoll";

/** A boundary sits this far before the onset it belongs to, so the onset is inside the next segment. */
const PRE_ONSET = 0.04;
export const MIN_SEGMENT = 0.3;

/** Distinct onset times; onsets within 50ms (chords / rolled chords) count as one. */
export const onsetClusters = (notes: PianoNote[]) => {
  const out: number[] = [];
  for (const n of notes) {
    if (!out.length || n.time - out[out.length - 1] > 0.05) out.push(n.time);
  }
  return out;
};

/**
 * Suggest segment boundaries (interior times, ascending).
 * Prefers places with a long gap before the next onset and real silence,
 * aiming for segments of ~target seconds within [min, max].
 */
export const autoSegment = (
  notes: PianoNote[],
  duration: number,
  { min = 4, target = 8, max = 14 } = {}
): number[] => {
  const on = onsetClusters(notes);
  if (on.length < 2) return [];

  const cands: { t: number; score: number }[] = [];
  let ni = 0;
  let maxEnd = 0;
  for (let i = 1; i < on.length; i++) {
    while (ni < notes.length && notes[ni].time < on[i] - 0.025) {
      maxEnd = Math.max(maxEnd, notes[ni].time + notes[ni].duration);
      ni++;
    }
    const gap = on[i] - on[i - 1];
    const silence = Math.max(0, on[i] - maxEnd);
    cands.push({ t: on[i] - Math.min(PRE_ONSET, gap * 0.4), score: gap + 2 * silence });
  }

  const out: number[] = [];
  let start = 0;
  for (;;) {
    if (duration - start <= max) break;
    let best: { t: number; score: number } | null = null;
    let bestScore = -Infinity;
    for (const c of cands) {
      const len = c.t - start;
      if (len < min) continue;
      if (len > max) break;
      const sc = c.score * (1 - 0.5 * Math.min(1, Math.abs(len - target) / target));
      if (sc > bestScore) {
        bestScore = sc;
        best = c;
      }
    }
    if (!best) best = cands.find((c) => c.t > start + min) ?? null; // very dense passage: take the next onset
    if (!best || duration - best.t < min) break; // don't leave a tiny tail
    out.push(best.t);
    start = best.t;
  }
  return out;
};

/** Snap to just before the nearest onset if it's within `tol` seconds. */
export const snapToOnset = (t: number, onsets: number[], tol: number) => {
  let lo = 0;
  let hi = onsets.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (onsets[mid] - PRE_ONSET < t) lo = mid + 1;
    else hi = mid;
  }
  let best = t;
  let bestD = tol;
  for (const i of [lo - 1, lo]) {
    if (i < 0 || i >= onsets.length) continue;
    const p = onsets[i] - PRE_ONSET;
    const d = Math.abs(p - t);
    if (d <= bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
};

/** Index of the segment containing t. */
export const segmentAt = (boundaries: number[], t: number) => {
  let k = 0;
  while (k < boundaries.length && boundaries[k] <= t + 1e-6) k++;
  return k;
};

export const segmentRange = (boundaries: number[], k: number, duration: number): [number, number] => [
  k === 0 ? 0 : boundaries[k - 1],
  k >= boundaries.length ? duration : boundaries[k],
];

/** Note-onset density for the timeline background, normalised to 0..1. */
export const densityBins = (notes: PianoNote[], duration: number, bins = 240) => {
  const out = new Array(bins).fill(0);
  if (!duration) return out;
  for (const n of notes) out[Math.min(bins - 1, Math.floor((n.time / duration) * bins))] += 0.4 + n.velocity;
  const max = Math.max(1e-6, ...out);
  return out.map((v) => v / max);
};

export const storageKey = (fileName: string, notes: PianoNote[]) =>
  `luna-melody:segments:${fileName}:${notes.length}`;
