import * as Tone from "tone";
import type { PianoNote } from "./PianoRoll";

export const lowerBound = (notes: PianoNote[], t: number) => {
  let lo = 0;
  let hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (notes[mid].time < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};

export type AutoStopReason = "segment" | "end";

/**
 * Small look-ahead scheduler on top of the audio clock.
 * Unlike Tone.Transport it supports playback-rate changes and a hard
 * `stopAt` time (used by Learn mode to pause exactly at a segment end).
 */
export class PlaybackEngine {
  sampler: Tone.Sampler | null = null;
  rate = 1;
  playing = false;
  /** Pause automatically when the playhead reaches this time (null = song end). */
  stopAt: number | null = null;
  onAutoStop?: (reason: AutoStopReason, at: number) => void;

  private notes: PianoNote[] = [];
  private names: string[] = [];
  private duration = 0;
  private pos = 0;
  private startCtx = 0;
  private startPos = 0;
  private nextIdx = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  setNotes(notes: PianoNote[], duration: number) {
    this.pause();
    this.notes = notes;
    this.names = notes.map((n) => Tone.Frequency(n.midi, "midi").toNote());
    this.duration = duration;
    this.pos = 0;
  }

  private now() {
    return Tone.getContext().currentTime;
  }

  private limit() {
    return Math.min(this.stopAt ?? Infinity, this.duration);
  }

  time() {
    if (!this.playing) return this.pos;
    const t = this.startPos + Math.max(0, this.now() - this.startCtx) * this.rate;
    return Math.min(t, this.limit());
  }

  async play() {
    if (this.playing || !this.notes.length) return;
    await Tone.start();
    this.playing = true;
    this.startPos = this.pos;
    this.startCtx = this.now() + 0.05;
    this.nextIdx = lowerBound(this.notes, this.pos - 1e-4);
    this.tick();
    this.timer = setInterval(() => this.tick(), 20);
  }

  pause(at?: number) {
    if (this.playing) this.pos = at ?? this.time();
    else if (at !== undefined) this.pos = at;
    this.playing = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.sampler?.releaseAll();
  }

  seek(t: number) {
    const was = this.playing;
    this.pause();
    this.pos = Math.min(Math.max(0, t), this.duration);
    if (was) this.play();
  }

  setRate(r: number) {
    const was = this.playing;
    this.pause();
    this.rate = r;
    if (was) this.play();
  }

  private tick() {
    if (!this.playing) return;
    const t = this.time();
    const lim = this.limit();
    if (t >= lim - 1e-4) {
      const reason: AutoStopReason = this.stopAt !== null && this.stopAt < this.duration ? "segment" : "end";
      this.pause(lim);
      this.onAutoStop?.(reason, lim);
      return;
    }
    const horizon = t + 0.12 * this.rate;
    const now = this.now();
    while (this.nextIdx < this.notes.length && this.notes[this.nextIdx].time < horizon) {
      const n = this.notes[this.nextIdx];
      if (n.time >= lim) break; // stopAt may still move (boundary drag), so don't skip past it
      const at = this.startCtx + (n.time - this.startPos) / this.rate;
      const dur = Math.max(0.03, Math.min(n.duration, lim - n.time) / this.rate);
      this.sampler?.triggerAttackRelease(this.names[this.nextIdx], dur, Math.max(at, now), n.velocity);
      this.nextIdx++;
    }
  }
}
