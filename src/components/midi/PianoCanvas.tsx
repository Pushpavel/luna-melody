import React, { useEffect, useRef } from "react";
import type { PianoNote } from "./PianoRoll";
import { lowerBound } from "./playback";

/**
 * Full-screen falling-notes visualizer rendered on a <canvas>.
 *
 * It reads the playhead from `timeRef` on every animation frame, so it never
 * needs React re-renders while playing / scrubbing.
 *
 * Visual language (important when paused):
 *  - Upcoming notes: fully rounded block with a dark border, floating above the keyboard.
 *  - Sounding notes: flat bottom edge fused into the hit line, brighter fill, glow,
 *    white outline, and the key below lights up in the same color and is depressed.
 */

const FIRST_MIDI = 21; // A0
const LAST_MIDI = 108; // C8
const WHITE_KEY_COUNT = 52;
const VISIBLE_SECONDS = 4.5;

const isBlack = (m: number) => {
  const pc = m % 12;
  return pc === 1 || pc === 3 || pc === 6 || pc === 8 || pc === 10;
};
// Nudges black keys off the exact white-key boundary, like a real keyboard
const BLACK_OFFSET: Record<number, number> = { 1: -0.12, 3: 0.12, 6: -0.15, 8: 0, 10: 0.15 };

type Key = { x: number; w: number; black: boolean };

const buildKeys = (width: number) => {
  const whiteW = width / WHITE_KEY_COUNT;
  const blackW = whiteW * 0.58;
  const keys: Key[] = [];
  let wi = 0;
  for (let m = FIRST_MIDI; m <= LAST_MIDI; m++) {
    if (!isBlack(m)) {
      keys[m] = { x: wi * whiteW, w: whiteW, black: false };
      wi++;
    } else {
      const boundary = wi * whiteW;
      keys[m] = { x: boundary - blackW / 2 + BLACK_OFFSET[m % 12] * blackW, w: blackW, black: true };
    }
  }
  return { keys, whiteW };
};

const COLORS = {
  bg: "#0a0c11",
  white: {
    idle: "hsl(190 85% 50%)",
    border: "hsl(195 90% 22%)",
    active: "hsl(185 100% 74%)",
    glow: "hsla(185, 100%, 65%, 0.9)",
    key: ["hsl(188 95% 68%)", "hsl(192 90% 50%)"],
  },
  black: {
    idle: "hsl(38 92% 50%)",
    border: "hsl(30 90% 20%)",
    active: "hsl(46 100% 72%)",
    glow: "hsla(45, 100%, 62%, 0.9)",
    key: ["hsl(44 100% 62%)", "hsl(34 95% 42%)"],
  },
};

/** Learn-mode view state, read every frame. */
export type LearnView = { boundaries: number[]; seg: number; duration: number };

type Props = {
  notes: PianoNote[]; // must be sorted by time
  timeRef: React.MutableRefObject<number>;
  learnRef?: React.MutableRefObject<LearnView | null>;
  onWheelSeek?: (deltaSeconds: number) => void;
  /** Drag of a segment boundary line in the notes area. tol = snapping tolerance (s). */
  onBoundaryDrag?: (i: number, t: number, tol: number, free: boolean) => void;
  className?: string;
};

type Visible = { n: PianoNote; k: Key; active: boolean; dim: boolean };

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;

const PianoCanvas: React.FC<Props> = ({ notes, timeRef, learnRef, onWheelSeek, onBoundaryDrag, className }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const notesRef = useRef(notes);
  const maxDurRef = useRef(0);
  const wheelRef = useRef(onWheelSeek);
  wheelRef.current = onWheelSeek;
  const dragCbRef = useRef(onBoundaryDrag);
  dragCbRef.current = onBoundaryDrag;

  useEffect(() => {
    notesRef.current = notes;
    maxDurRef.current = notes.reduce((a, n) => Math.max(a, n.duration), 0);
  }, [notes]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    let w = 0;
    let h = 0;
    let dpr = 1;
    let layout = buildKeys(1);
    let raf = 0;
    let energy = 0;
    // geometry of the last frame, used for pointer hit-testing
    let lastLaneH = 1;
    let lastPps = 1;
    let lastT = 0;
    let dragIdx: number | null = null;
    let hoverIdx: number | null = null;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = window.devicePixelRatio || 1;
      w = Math.max(1, rect.width);
      h = Math.max(1, rect.height);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      layout = buildKeys(w);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    const activeKeys: (PianoNote | null)[] = new Array(128).fill(null);
    const whites: Visible[] = [];
    const blacks: Visible[] = [];

    const drawNote = (v: Visible, laneH: number, pps: number, t: number) => {
      const { n, k, active, dim } = v;
      const pal = k.black ? COLORS.black : COLORS.white;
      const inset = k.black ? 1 : Math.max(1.5, k.w * 0.06);
      const x = k.x + inset;
      const nw = Math.max(2, k.w - inset * 2);
      const yBottom = active ? laneH : laneH - (n.time - t) * pps;
      let yTop = laneH - (n.time + n.duration - t) * pps;
      if (yBottom - yTop < 4) yTop = yBottom - 4;
      if (yBottom < 0) return;
      const nh = yBottom - yTop;
      const r = Math.min(nw * 0.3, 6, nh / 2);

      if (active) {
        ctx.save();
        ctx.shadowColor = pal.glow;
        ctx.shadowBlur = 22;
        ctx.fillStyle = pal.active;
        ctx.beginPath();
        ctx.roundRect(x, yTop, nw, nh, [r, r, 0, 0]); // flat bottom: fused into the keyboard
        ctx.fill();
        ctx.restore();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = "rgba(255,255,255,0.9)";
        ctx.beginPath();
        ctx.roundRect(x + 0.75, yTop + 0.75, nw - 1.5, nh - 0.75, [r, r, 0, 0]);
        ctx.stroke();
      } else {
        ctx.globalAlpha = dim ? 0.16 : 0.7 + 0.3 * Math.min(1, Math.max(0, n.velocity));
        ctx.fillStyle = pal.idle;
        ctx.beginPath();
        ctx.roundRect(x, yTop, nw, nh, r);
        ctx.fill();
        ctx.globalAlpha = 1;
        if (dim) return;
        ctx.lineWidth = 1;
        ctx.strokeStyle = pal.border;
        ctx.stroke();
        // small top sheen
        ctx.fillStyle = "rgba(255,255,255,0.14)";
        ctx.beginPath();
        ctx.roundRect(x + 1, yTop + 1, nw - 2, Math.min(nh - 2, 6), r);
        ctx.fill();
      }
    };

    const label = (text: string, y: number, bg: string, fg: string) => {
      ctx.font = "600 11px ui-sans-serif, system-ui, sans-serif";
      const tw = ctx.measureText(text).width;
      const ly = Math.max(10, Math.min(lastLaneH - 10, y));
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.roundRect(8, ly - 10, tw + 14, 20, 10);
      ctx.fill();
      ctx.fillStyle = fg;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(text, 15, ly + 0.5);
      ctx.textBaseline = "alphabetic";
    };

    const drawLearnOverlay = (learn: LearnView, t: number, laneH: number, pps: number, segStart: number, segEnd: number) => {
      const yOf = (time: number) => laneH - (time - t) * pps;
      // Shade everything after the segment end: this is the "cut"
      const yEnd = yOf(segEnd);
      if (yEnd > 0) {
        const top = 0;
        const bottom = Math.min(laneH, yEnd);
        ctx.fillStyle = "rgba(6,7,11,0.55)";
        ctx.fillRect(0, top, w, bottom - top);
      }
      // Shade what's before the segment start (only visible after scrolling back)
      const yStart = yOf(segStart);
      if (yStart < laneH && segStart > t) {
        ctx.fillStyle = "rgba(6,7,11,0.55)";
        ctx.fillRect(0, yStart, w, laneH - yStart);
      }

      learn.boundaries.forEach((b, i) => {
        const y = yOf(b);
        if (y < -2 || y > laneH + 2) return;
        const isEnd = b === segEnd;
        const isStart = b === segStart;
        const hot = dragIdx === i || hoverIdx === i;
        ctx.save();
        if (isEnd || isStart) {
          ctx.strokeStyle = isEnd ? "hsl(45 95% 58%)" : "hsl(190 90% 60%)";
          ctx.lineWidth = hot ? 3 : 2;
          ctx.shadowColor = ctx.strokeStyle;
          ctx.shadowBlur = hot ? 14 : 8;
        } else {
          ctx.strokeStyle = hot ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.28)";
          ctx.lineWidth = hot ? 2 : 1;
          ctx.setLineDash([6, 6]);
        }
        ctx.beginPath();
        ctx.moveTo(0, Math.round(y) + 0.5);
        ctx.lineTo(w, Math.round(y) + 0.5);
        ctx.stroke();
        ctx.restore();
        if (isEnd) label(`End of segment ${learn.seg + 1}${hot ? `  ${fmtTime(b)}` : "  ⇕ drag"}`, y - 14, "hsl(45 95% 55%)", "#1a1203");
        else if (isStart) label(`Start of segment ${learn.seg + 1}`, y + 14, "hsl(190 90% 55%)", "#03161a");
        else label(`${i + 2}`, y - 12, "rgba(255,255,255,0.12)", "rgba(255,255,255,0.7)");
      });
      if (segEnd === learn.duration) {
        const y = yOf(segEnd);
        if (y > 0 && y < laneH) label("End of song", y - 14, "rgba(255,255,255,0.15)", "rgba(255,255,255,0.8)");
      }
    };

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const t = timeRef.current;
      const { keys, whiteW } = layout;
      const kbH = Math.min(Math.max(whiteW * 4.6, 70), h * 0.24);
      const laneH = h - kbH;
      const pps = laneH / VISIBLE_SECONDS;
      lastLaneH = laneH;
      lastPps = pps;
      lastT = t;
      const learn = learnRef?.current ?? null;
      let segStart = -Infinity;
      let segEnd = Infinity;
      if (learn) {
        segStart = learn.seg === 0 ? 0 : learn.boundaries[learn.seg - 1];
        segEnd = learn.seg >= learn.boundaries.length ? learn.duration : learn.boundaries[learn.seg];
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = COLORS.bg;
      ctx.fillRect(0, 0, w, h);

      // Collect visible notes + sounding notes
      activeKeys.fill(null);
      whites.length = 0;
      blacks.length = 0;
      let energyTarget = 0;
      const ns = notesRef.current;
      for (let i = lowerBound(ns, t - maxDurRef.current - 0.01); i < ns.length; i++) {
        const n = ns[i];
        if (n.time > t + VISIBLE_SECONDS + 0.2) break;
        if (n.time + n.duration <= t) continue;
        const k = keys[n.midi];
        if (!k) continue;
        const inSeg = n.time >= segStart - 1e-4 && n.time < segEnd - 1e-4;
        const active = n.time <= t && inSeg;
        if (active) {
          const prev = activeKeys[n.midi];
          if (!prev || n.time > prev.time) activeKeys[n.midi] = n;
          energyTarget += n.velocity;
        }
        (k.black ? blacks : whites).push({ n, k, active, dim: !inSeg });
      }

      // Reactive background glow, driven by how much is sounding
      energy += (energyTarget - energy) * 0.08;
      if (energy > 0.02) {
        const g = ctx.createRadialGradient(w / 2, laneH, 0, w / 2, laneH, Math.max(w, h) * 0.75);
        const a = Math.min(0.28, energy * 0.045);
        g.addColorStop(0, `hsla(190, 90%, 55%, ${a})`);
        g.addColorStop(0.5, `hsla(260, 80%, 50%, ${a * 0.35})`);
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, laneH);
      }

      // Octave guides (C lines brighter, F lines faint)
      for (let m = FIRST_MIDI; m <= LAST_MIDI; m++) {
        const pc = m % 12;
        if (pc !== 0 && pc !== 5) continue;
        const x = Math.round(keys[m].x) + 0.5;
        ctx.strokeStyle = pc === 0 ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.035)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, laneH);
        ctx.stroke();
      }
      // Moving one-second guides give a sense of time even when paused
      ctx.strokeStyle = "rgba(255,255,255,0.035)";
      for (let s = Math.ceil(t); s <= t + VISIBLE_SECONDS; s++) {
        const y = Math.round(laneH - (s - t) * pps) + 0.5;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      // Notes: upcoming first, sounding on top; black-key notes above white-key ones
      for (const v of whites) if (!v.active) drawNote(v, laneH, pps, t);
      for (const v of blacks) if (!v.active) drawNote(v, laneH, pps, t);
      for (const v of whites) if (v.active) drawNote(v, laneH, pps, t);
      for (const v of blacks) if (v.active) drawNote(v, laneH, pps, t);

      if (learn) drawLearnOverlay(learn, t, laneH, pps, segStart, segEnd);

      // Contact glow on the hit line for sounding keys
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (let m = FIRST_MIDI; m <= LAST_MIDI; m++) {
        const n = activeKeys[m];
        if (!n) continue;
        const k = keys[m];
        const cx = k.x + k.w / 2;
        const rad = Math.max(18, k.w * 2.2);
        const g = ctx.createRadialGradient(cx, laneH, 0, cx, laneH, rad);
        const col = k.black ? "255, 200, 90" : "120, 235, 255";
        g.addColorStop(0, `rgba(${col}, ${0.55 + 0.35 * n.velocity})`);
        g.addColorStop(1, `rgba(${col}, 0)`);
        ctx.fillStyle = g;
        ctx.fillRect(cx - rad, laneH - rad, rad * 2, rad);
      }
      ctx.restore();

      // ---------- Keyboard ----------
      ctx.fillStyle = "#050608";
      ctx.fillRect(0, laneH, w, kbH);

      const whiteGap = whiteW > 10 ? 1 : 0.5;
      ctx.font = `${Math.max(8, Math.min(11, whiteW * 0.38))}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = "center";
      for (let m = FIRST_MIDI; m <= LAST_MIDI; m++) {
        if (isBlack(m)) continue;
        const k = keys[m];
        const pressed = activeKeys[m];
        const top = laneH + (pressed ? 3 : 0);
        const kh = kbH - (pressed ? 3 : 0) - 1;
        const g = ctx.createLinearGradient(0, top, 0, top + kh);
        if (pressed) {
          g.addColorStop(0, COLORS.white.key[0]);
          g.addColorStop(1, COLORS.white.key[1]);
        } else {
          g.addColorStop(0, "#d9d8d2");
          g.addColorStop(0.12, "#f3f2ed");
          g.addColorStop(1, "#e6e5df");
        }
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.roundRect(k.x + whiteGap / 2, top, k.w - whiteGap, kh, [0, 0, 4, 4]);
        ctx.fill();
        if (!pressed) {
          // front lip
          ctx.fillStyle = "rgba(0,0,0,0.08)";
          ctx.fillRect(k.x + whiteGap / 2, laneH + kbH - 7, k.w - whiteGap, 6);
        }
        if (m % 12 === 0 && whiteW > 12) {
          ctx.fillStyle = pressed ? "rgba(0,30,40,0.7)" : "rgba(0,0,0,0.38)";
          ctx.fillText(`C${m / 12 - 1}`, k.x + k.w / 2, laneH + kbH - 12);
        }
      }

      const bh = kbH * 0.63;
      for (let m = FIRST_MIDI; m <= LAST_MIDI; m++) {
        if (!isBlack(m)) continue;
        const k = keys[m];
        const pressed = activeKeys[m];
        const kh = bh - (pressed ? 2 : 0);
        // shadow on the white keys
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        ctx.fillRect(k.x + 2, laneH, k.w, bh + 3);
        const g = ctx.createLinearGradient(0, laneH, 0, laneH + kh);
        if (pressed) {
          g.addColorStop(0, COLORS.black.key[1]);
          g.addColorStop(1, COLORS.black.key[0]);
        } else {
          g.addColorStop(0, "#0c0c10");
          g.addColorStop(1, "#2b2b33");
        }
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.roundRect(k.x, laneH, k.w, kh, [0, 0, 3, 3]);
        ctx.fill();
        if (!pressed) {
          ctx.fillStyle = "rgba(255,255,255,0.10)";
          ctx.fillRect(k.x + 2, laneH + kh - Math.max(5, kh * 0.09), k.w - 4, Math.max(3, kh * 0.06));
        }
      }

      // Shadow cast onto the keys by the rail, then the accent rail itself
      const sg = ctx.createLinearGradient(0, laneH, 0, laneH + 10);
      sg.addColorStop(0, "rgba(0,0,0,0.45)");
      sg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = sg;
      ctx.fillRect(0, laneH, w, 10);
      const rail = ctx.createLinearGradient(0, 0, w, 0);
      rail.addColorStop(0, "hsl(190 90% 45%)");
      rail.addColorStop(0.5, "hsl(220 80% 55%)");
      rail.addColorStop(1, "hsl(45 92% 50%)");
      ctx.fillStyle = rail;
      ctx.fillRect(0, laneH - 1, w, 3);
    };
    raf = requestAnimationFrame(draw);

    const onWheel = (e: WheelEvent) => {
      if (!wheelRef.current) return;
      e.preventDefault();
      // wheel down = move forward in time
      wheelRef.current((e.deltaY / Math.max(1, h)) * VISIBLE_SECONDS);
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });

    const boundaryAt = (clientY: number) => {
      const learn = learnRef?.current;
      if (!learn || !dragCbRef.current) return null;
      const y = clientY - canvas.getBoundingClientRect().top;
      if (y > lastLaneH + 4) return null;
      let best: number | null = null;
      let bestD = 8;
      learn.boundaries.forEach((b, i) => {
        const d = Math.abs(lastLaneH - (b - lastT) * lastPps - y);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      return best;
    };
    const timeAtY = (clientY: number) => lastT + (lastLaneH - (clientY - canvas.getBoundingClientRect().top)) / lastPps;
    const onDown = (e: PointerEvent) => {
      const i = boundaryAt(e.clientY);
      if (i === null) return;
      dragIdx = i;
      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
    };
    const onMove = (e: PointerEvent) => {
      if (dragIdx !== null) {
        dragCbRef.current?.(dragIdx, timeAtY(e.clientY), 10 / lastPps, e.altKey);
        return;
      }
      hoverIdx = boundaryAt(e.clientY);
      canvas.style.cursor = hoverIdx !== null ? "ns-resize" : "";
    };
    const onUp = () => {
      dragIdx = null;
    };
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
    };
  }, [timeRef, learnRef]);

  return <canvas ref={canvasRef} className={className} style={{ display: "block", width: "100%", height: "100%" }} />;
};

export default React.memo(PianoCanvas);
