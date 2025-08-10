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

  // Simplified color mapping: 2 colors from theme
  // - Black-key notes: brand color
  // - White-key notes: brand-2 color
  const colorForKeyType = (m: number) => (isBlack(m) ? `hsl(var(--brand))` : `hsl(var(--brand-2))`);

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

  // Partition notes so white-key notes render first, black-key notes render on top
  const partitioned = useMemo(() => {
    const whites: Array<{ n: PianoNote; x: number; w: number; y: number; h: number }> = [];
    const blacks: Array<{ n: PianoNote; x: number; w: number; y: number; h: number }> = [];
    for (const it of visibleNotes) {
      if (isBlack(it.n.midi)) blacks.push(it);
      else whites.push(it);
    }
    return { whites, blacks };
  }, [visibleNotes]);

  return (
    <div ref={containerRef} className="surface-card w-full overflow-hidden" style={{ height }}>
      <svg width={width} height={height} className="block w-full h-full">
        <defs>
          <linearGradient id="noteFillVertical" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={`hsl(var(--brand))`} />
            <stop offset="100%" stopColor={`hsl(var(--brand-2))`} />
          </linearGradient>
          {/* Modern dark theme gradients for keys and background */}
          <linearGradient id="whiteKeyDarkGradient" x1="0" y1="0" x2="0" y2="1">
            {/* Subtle dark base for keys to match bg-slate tones */}
            <stop offset="0%" stopColor="#0b1220" />
            <stop offset="100%" stopColor="#111827" />
          </linearGradient>
          <linearGradient id="blackKeyDarkGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0b1220" />
            <stop offset="100%" stopColor="#020617" />
          </linearGradient>
          <linearGradient id="keyHighlightDark" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="keyboardBgDark" x1="0" y1="0" x2="0" y2="1">
            {/* from-slate-900 to-slate-800 */}
            <stop offset="0%" stopColor="#0f172a" />
            <stop offset="100%" stopColor="#1e293b" />
          </linearGradient>
          <filter id="keyShadow" x="-10%" y="-10%" width="120%" height="120%">
            <feDropShadow dx="0" dy="2" stdDeviation="1.6" floodColor="#000" floodOpacity="0.22" />
          </filter>
          {/* soft shadow for falling notes */}
          <filter id="fallShadow" x="-20%" y="-20%" width="140%" height="160%">
            <feDropShadow dx="0" dy="0.9" stdDeviation="1.1" floodColor="#000" floodOpacity="0.35" />
          </filter>
          {/* additive glow so overlapping notes become brighter */}
          <filter id="noteGlow" x="-40%" y="-40%" width="180%" height="220%">
            <feGaussianBlur stdDeviation="2.6" />
          </filter>
          {/* soft glow for the playhead line */}
          <filter id="playheadGlow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="2" result="pb" />
            <feMerge>
              <feMergeNode in="pb" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          {/* sheen for note bodies */}
          <linearGradient id="noteSheen" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
          {/* subtle hatch pattern for black-key notes */}
          <pattern id="blackNoteHatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="none" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="#fff" strokeOpacity="0.08" strokeWidth="1" />
          </pattern>
        </defs>

        {/* Inline CSS for subtle animations and reduced motion */}
        <style>
          {`
            .note-enter { animation: fadeIn .3s ease-out both; }
            @keyframes fadeIn { from { opacity: 0; transform: translateY(-4px) } to { opacity: 1; transform: translateY(0) } }
            @media (prefers-reduced-motion: reduce) { .note-enter { animation: none !important; } }
            .lane-stripe { mix-blend-mode: soft-light; }
            .edge-highlight { mix-blend-mode: screen; }
            .edge-dark { mix-blend-mode: multiply; }
            .blend-screen { mix-blend-mode: screen; }
          `}
        </style>

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

        {/* Vertical key column tints to improve note separation */}
        {Array.from({ length: maxMidi - minMidi + 1 }, (_, i) => minMidi + i).map((m) => {
          const k = keyMap[m];
          const blk = isBlack(m);
          return (
            <rect
              key={`col-${m}`}
              x={k.x}
              y={0}
              width={k.w}
              height={laneHeight}
              className="lane-stripe"
              fill={blk ? "#0b1220" : "#ffffff"}
              opacity={blk ? 0.05 : 0.03}
              pointerEvents="none"
            />
          );
        })}

        {/* Falling notes: render white-key notes first */}
        {partitioned.whites.map((it, idx) => {
          const vel = clamp(it.n.velocity, 0, 1);
          const fillCol = colorForKeyType(it.n.midi);
          const baseOpacity = 0.62 + 0.28 * vel; // was 0.5 + 0.3*vel
          const capH = Math.min(3, Math.max(2, it.h * 0.08));
          const strokeColor = fillCol; // color-coded outline
          const strokeOpacity = 0.22; // was black 0.22
          return (
            <g key={`w-${idx}`} className="note-enter">
              {/* glow layer (additive) - reduced to preserve hue */}
              <rect
                x={it.x + 1}
                y={it.y}
                width={Math.max(2, it.w - 2)}
                height={it.h}
                rx={4}
                fill={fillCol}
                opacity={0.18 + 0.22 * vel} // was 0.32 + 0.38*vel
                filter="url(#noteGlow)"
                className="blend-screen"
              />
              {/* main body */}
              <rect
                x={it.x + 1}
                y={it.y}
                width={Math.max(2, it.w - 2)}
                height={it.h}
                rx={3}
                fill={fillCol}
                opacity={baseOpacity}
                filter="url(#fallShadow)"
              />
              {/* left dark edge for separation */}
              <rect
                x={it.x + 1}
                y={it.y}
                width={1.25}
                height={it.h}
                rx={1}
                fill="#000000"
                opacity={0.18}
                className="edge-dark"
                pointerEvents="none"
              />
              {/* top sheen */}
              <rect
                x={it.x + 1.25}
                y={it.y + 0.25}
                width={Math.max(0, it.w - 2.5)}
                height={Math.min(it.h * 0.38, 12)}
                rx={2.5}
                fill="url(#noteSheen)"
                pointerEvents="none"
              />
              {/* thin outline */}
              <rect
                x={it.x + 1.25}
                y={it.y + 0.25}
                width={Math.max(0, it.w - 2.5)}
                height={Math.max(0, it.h - 0.5)}
                rx={2.5}
                fill="none"
                stroke={strokeColor}
                opacity={strokeOpacity}
                pointerEvents="none"
              />
              {/* bottom cap */}
              <rect
                x={it.x + 1}
                y={it.y + it.h - capH}
                width={Math.max(2, it.w - 2)}
                height={capH}
                rx={2}
                fill={fillCol}
                opacity={0.65}
                className="blend-screen"
              />
            </g>
          );
        })}

        {/* Falling notes: render black-key notes on top */}
        {partitioned.blacks.map((it, idx) => {
          const vel = clamp(it.n.velocity, 0, 1);
          const fillCol = colorForKeyType(it.n.midi);
          const baseOpacity = 0.66 + 0.26 * vel; // was 0.52 + 0.32*vel
          const capH = Math.min(3, Math.max(2, it.h * 0.08));
          const strokeColor = fillCol; // color-coded outline
          const strokeOpacity = 0.24; // was white 0.18
          return (
            <g key={`b-${idx}`} className="note-enter">
              {/* glow layer (additive) - reduced to preserve hue */}
              <rect
                x={it.x + 1}
                y={it.y}
                width={Math.max(2, it.w - 2)}
                height={it.h}
                rx={4}
                fill={fillCol}
                opacity={0.2 + 0.24 * vel} // was 0.35 + 0.4*vel
                filter="url(#noteGlow)"
                className="blend-screen"
              />
              {/* main body */}
              <rect
                x={it.x + 1}
                y={it.y}
                width={Math.max(2, it.w - 2)}
                height={it.h}
                rx={3}
                fill={fillCol}
                opacity={baseOpacity}
                filter="url(#fallShadow)"
              />
              {/* subtle hatch to mark black-key notes - slightly stronger */}
              <rect
                x={it.x + 1}
                y={it.y}
                width={Math.max(2, it.w - 2)}
                height={it.h}
                rx={3}
                fill="url(#blackNoteHatch)"
                opacity={0.4} // was 0.3
                pointerEvents="none"
              />
              {/* left light edge for separation */}
              <rect
                x={it.x + 1}
                y={it.y}
                width={1.25}
                height={it.h}
                rx={1}
                fill="#ffffff"
                opacity={0.25}
                className="edge-highlight"
                pointerEvents="none"
              />
              {/* top sheen */}
              <rect
                x={it.x + 1.25}
                y={it.y + 0.25}
                width={Math.max(0, it.w - 2.5)}
                height={Math.min(it.h * 0.38, 12)}
                rx={2.5}
                fill="url(#noteSheen)"
                pointerEvents="none"
              />
              {/* thin outline */}
              <rect
                x={it.x + 1.25}
                y={it.y + 0.25}
                width={Math.max(0, it.w - 2.5)}
                height={Math.max(0, it.h - 0.5)}
                rx={2.5}
                fill="none"
                stroke={strokeColor}
                opacity={strokeOpacity}
                pointerEvents="none"
              />
              {/* bottom cap */}
              <rect
                x={it.x + 1}
                y={it.y + it.h - capH}
                width={Math.max(2, it.w - 2)}
                height={capH}
                rx={2}
                fill={fillCol}
                opacity={0.7}
                className="blend-screen"
              />
            </g>
          );
        })}

        {/* Playhead where notes hit the keyboard */}
        <line
          x1={0}
          x2={width}
          y1={laneHeight}
          y2={laneHeight}
          stroke={`hsl(var(--brand))`}
          strokeWidth={2}
          opacity={0.9}
          filter="url(#playheadGlow)"
        />

        {/* Keyboard background */}
        <rect
          x={0}
          y={laneHeight}
          width={width}
          height={keyboardHeight}
          fill="url(#keyboardBgDark)"
        />

        {/* White keys */}
        {Array.from({ length: maxMidi - minMidi + 1 }, (_, i) => minMidi + i)
          .filter((m) => !isBlack(m))
          .map((m) => {
            const k = keyMap[m];
            const active = activeSet.has(m);
            return (
              <g key={`w-${m}`}>
                {/* Key shadow */}
                <rect
                  x={k.x}
                  y={laneHeight + 2}
                  width={k.w}
                  height={keyboardHeight - 2}
                  rx={6}
                  fill="none"
                  filter="url(#keyShadow)"
                />
                {/* Key body with dark gradient to blend with bg */}
                <rect
                  x={k.x}
                  y={laneHeight}
                  width={k.w}
                  height={keyboardHeight}
                  rx={6}
                  fill="url(#whiteKeyDarkGradient)"
                  stroke="hsl(var(--border))"
                  strokeWidth={1}
                  opacity={0.98}
                />
                {/* Subtle white veil like bg-white/3 */}
                <rect
                  x={k.x + 1}
                  y={laneHeight + 1}
                  width={k.w - 2}
                  height={keyboardHeight - 2}
                  rx={5}
                  fill="hsl(var(--background))"
                  opacity={0.05}
                  pointerEvents="none"
                />
                {/* Glossy highlight */}
                <rect
                  x={k.x + 1}
                  y={laneHeight + 1}
                  width={k.w - 2}
                  height={keyboardHeight * 0.22}
                  rx={4}
                  fill="url(#keyHighlightDark)"
                  pointerEvents="none"
                />
                {/* Active highlight - white keys use brand-2 */}
                {active && (
                  <>
                    <rect
                      x={k.x + 1}
                      y={laneHeight + 1}
                      width={k.w - 2}
                      height={keyboardHeight - 2}
                      rx={4}
                      fill="hsl(var(--brand-2))"
                      opacity={0.24}
                      style={{ mixBlendMode: "soft-light" }}
                    />
                    <rect
                      x={k.x + 1}
                      y={laneHeight + 1}
                      width={k.w - 2}
                      height={keyboardHeight - 2}
                      rx={4}
                      fill="none"
                      stroke={`hsl(var(--brand-2))`}
                      opacity={0.45}
                      filter="url(#playheadGlow)"
                      pointerEvents="none"
                    />
                  </>
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
                {/* Key shadow */}
                <rect
                  x={k.x}
                  y={laneHeight + 2}
                  width={k.w}
                  height={h - 2}
                  rx={4}
                  fill="none"
                  filter="url(#keyShadow)"
                />
                {/* Key body with dark gradient */}
                <rect
                  x={k.x}
                  y={laneHeight}
                  width={k.w}
                  height={h}
                  rx={4}
                  fill="url(#blackKeyDarkGradient)"
                  opacity={0.98}
                />
                {/* Glossy highlight */}
                <rect
                  x={k.x + 0.5}
                  y={laneHeight + 1}
                  width={k.w - 1}
                  height={h * 0.32}
                  rx={3}
                  fill="url(#keyHighlightDark)"
                  pointerEvents="none"
                />
                {/* Active highlight - black keys use brand */}
                {active && (
                  <>
                    <rect
                      x={k.x + 1}
                      y={laneHeight + 1}
                      width={k.w - 2}
                      height={h - 2}
                      rx={3}
                      fill="hsl(var(--brand))"
                      opacity={0.28}
                      style={{ mixBlendMode: "screen" }}
                    />
                    <rect
                      x={k.x + 1}
                      y={laneHeight + 1}
                      width={k.w - 2}
                      height={h - 2}
                      rx={3}
                      fill="none"
                      stroke={`hsl(var(--brand))`}
                      opacity={0.5}
                      filter="url(#playheadGlow)"
                      pointerEvents="none"
                    />
                  </>
                )}
              </g>
            );
          })}
      </svg>
    </div>
  );
};

export default FallingPiano;
