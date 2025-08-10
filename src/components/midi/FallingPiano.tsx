import React, { useEffect, useMemo, useRef, useState } from "react";
import { PianoNote } from "./PianoRoll";

// Falling notes visualization with a piano keyboard at the bottom
// Props are compatible with PianoRoll so it can be a drop-in replacement

type FallingPianoProps = {
  notes: PianoNote[];
  currentTime: number; // seconds
  totalDuration: number; // seconds
  height?: number;
};

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const isBlack = (midi: number) => {
  const pc = midi % 12;
  return pc === 1 || pc === 3 || pc === 6 || pc === 8 || pc === 10; // C#, D#, F#, G#, A#
};

const FallingPiano: React.FC<FallingPianoProps> = ({
  notes,
  currentTime,
  totalDuration, // not used for scale, but kept for compatibility
  height = 520,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(800);

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const cr = entry.contentRect;
        setWidth(Math.max(320, Math.floor(cr.width)));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { minMidi, maxMidi } = useMemo(() => {
    if (notes.length === 0) return { minMidi: 21, maxMidi: 108 };
    let min = Infinity;
    let max = -Infinity;
    for (const n of notes) {
      if (n.midi < min) min = n.midi;
      if (n.midi > max) max = n.midi;
    }
    min = clamp(min, 21, 108);
    max = clamp(max, 21, 108);
    if (max - min < 12) max = Math.min(108, min + 12); // ensure sensible range
    return { minMidi: min, maxMidi: max };
  }, [notes]);

  const keyboardHeight = 88; // px
  const laneHeight = Math.max(120, height - keyboardHeight);

  // Visible time window (seconds) above the keyboard
  const visibleSeconds = 8;
  const pps = laneHeight / visibleSeconds; // pixels per second

  // Build key map for positions and sizes
  type KeyInfo = { x: number; w: number; black: boolean };
  const keyMap: Record<number, KeyInfo> = useMemo(() => {
    const map: Record<number, KeyInfo> = {};

    // Count white keys to set base width
    let whiteCount = 0;
    for (let m = minMidi; m <= maxMidi; m++) if (!isBlack(m)) whiteCount++;
    const whiteWidth = width / Math.max(1, whiteCount);

    let currentWhite = 0;
    for (let m = minMidi; m <= maxMidi; m++) {
      if (!isBlack(m)) {
        const x = currentWhite * whiteWidth;
        map[m] = { x, w: whiteWidth, black: false };
        currentWhite++;
      } else {
        const prevWhiteIndex = Math.max(0, currentWhite - 1);
        const xPrev = prevWhiteIndex * whiteWidth;
        const bw = whiteWidth * 0.6;
        const x = xPrev + whiteWidth * 0.66 - bw / 2; // centered between whites
        map[m] = { x: clamp(x, 0, width - bw), w: bw, black: true };
      }
    }
    return map;
  }, [minMidi, maxMidi, width]);

  // Active notes for key highlighting
  const activeSet = useMemo(() => {
    const s = new Set<number>();
    for (const n of notes) {
      if (currentTime >= n.time && currentTime <= n.time + n.duration) s.add(n.midi);
    }
    return s;
  }, [notes, currentTime]);

  // Determine which notes are in the visible falling window
  const visibleNotes = useMemo(() => {
    const list: Array<{ n: PianoNote; x: number; w: number; y: number; h: number }> = [];
    for (const n of notes) {
      const km = keyMap[n.midi];
      if (!km) continue;
      const dtStart = n.time - currentTime; // seconds until start
      const dtEnd = n.time + n.duration - currentTime; // seconds until end

      // Skip notes that are way past (ended below keyboard) or far future (above top)
      if (dtEnd < -1) continue;
      if (dtStart > visibleSeconds + 1) continue;

      const yBottom = laneHeight - dtStart * pps; // where the note head is now
      const h = Math.max(2, n.duration * pps);
      const yTop = yBottom - h;

      // Clip to lane
      const y = clamp(yTop, 0, laneHeight);
      const clippedH = clamp(yBottom, 0, laneHeight) - y;
      if (clippedH <= 0) continue;

      list.push({ n, x: km.x, w: km.w, y, h: clippedH });
    }
    // sort by y to ensure nicer layering
    list.sort((a, b) => a.y - b.y);
    return list;
  }, [notes, keyMap, currentTime, laneHeight, pps]);

  return (
    <div ref={containerRef} className="surface-card w-full overflow-hidden" style={{ height }}>
      <svg width={width} height={height} className="block w-full h-full">
        <defs>
          <linearGradient id="noteFillVertical" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={`hsl(var(--brand))`} />
            <stop offset="100%" stopColor={`hsl(var(--brand-2))`} />
          </linearGradient>
        </defs>

        {/* Lane background grid */}
        {[...Array(8)].map((_, i) => (
          <line
            key={`grid-${i}`}
            x1={0}
            x2={width}
            y1={(i / 8) * laneHeight}
            y2={(i / 8) * laneHeight}
            stroke="hsl(var(--border))"
            strokeOpacity={i % 2 === 0 ? 0.35 : 0.18}
          />
        ))}

        {/* Falling notes */}
        {visibleNotes.map((it, idx) => (
          <g key={idx} className="animate-fade-in">
            <rect
              x={it.x + 1}
              y={it.y}
              width={Math.max(2, it.w - 2)}
              height={it.h}
              rx={3}
              fill="url(#noteFillVertical)"
              opacity={0.6 + 0.35 * clamp(it.n.velocity, 0, 1)}
            />
          </g>
        ))}

        {/* Playhead where notes hit the keyboard */}
        <line
          x1={0}
          x2={width}
          y1={laneHeight}
          y2={laneHeight}
          stroke={`hsl(var(--brand))`}
          strokeWidth={2}
          opacity={0.9}
        />

        {/* Keyboard background */}
        <rect
          x={0}
          y={laneHeight}
          width={width}
          height={keyboardHeight}
          fill={`hsl(var(--card))`}
        />

        {/* White keys */}
        {Array.from({ length: maxMidi - minMidi + 1 }, (_, i) => minMidi + i)
          .filter((m) => !isBlack(m))
          .map((m) => {
            const k = keyMap[m];
            const active = activeSet.has(m);
            return (
              <g key={`w-${m}`}>
                <rect
                  x={k.x}
                  y={laneHeight}
                  width={k.w}
                  height={keyboardHeight}
                  fill={`hsl(var(--background))`}
                  stroke={`hsl(var(--border))`}
                  strokeWidth={0.75}
                  opacity={0.9}
                />
                {active && (
                  <rect
                    x={k.x + 1}
                    y={laneHeight + 1}
                    width={k.w - 2}
                    height={keyboardHeight - 2}
                    rx={3}
                    fill={`hsl(var(--brand))`}
                    opacity={0.25}
                  />
                )}
              </g>
            );
          })}

        {/* Black keys */}
        {Array.from({ length: maxMidi - minMidi + 1 }, (_, i) => minMidi + i)
          .filter((m) => isBlack(m))
          .map((m) => {
            const k = keyMap[m];
            const active = activeSet.has(m);
            const h = keyboardHeight * 0.62;
            return (
              <g key={`b-${m}`}>
                <rect
                  x={k.x}
                  y={laneHeight}
                  width={k.w}
                  height={h}
                  fill={`hsl(var(--muted-foreground))`}
                  opacity={0.9}
                />
                {active && (
                  <rect
                    x={k.x + 1}
                    y={laneHeight + 1}
                    width={k.w - 2}
                    height={h - 2}
                    rx={2}
                    fill={`hsl(var(--brand-2))`}
                    opacity={0.35}
                  />
                )}
              </g>
            );
          })}
      </svg>
    </div>
  );
};

export default FallingPiano;
