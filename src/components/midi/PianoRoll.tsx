import React, { useEffect, useMemo, useRef, useState } from "react";

export type PianoNote = {
  midi: number;
  time: number; // seconds
  duration: number; // seconds
  velocity: number; // 0..1
};

type PianoRollProps = {
  notes: PianoNote[];
  currentTime: number; // seconds
  totalDuration: number; // seconds
  height?: number;
  // Optional: overlay a subtle hatch on black-key notes to make the two-color scheme more obvious
  showBlackHatch?: boolean;
};

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

// Map MIDI pitch class to black/white key for two-color scheme
const BLACK_KEY_PC = new Set([1, 3, 6, 8, 10]);
const isBlackKey = (midi: number) => BLACK_KEY_PC.has(midi % 12);
const colorForKeyType = (midi: number) => (isBlackKey(midi) ? `hsl(var(--brand))` : `hsl(var(--brand-2))`);

export const PianoRoll: React.FC<PianoRollProps> = ({
  notes,
  currentTime,
  totalDuration,
  height = 420,
  showBlackHatch = true,
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

  const pps = useMemo(() => {
    return totalDuration > 0 ? width / totalDuration : 100;
  }, [width, totalDuration]);

  const midiToY = (midi: number) => {
    const range = maxMidi - minMidi;
    const normalized = clamp((midi - minMidi) / (range || 1), 0, 1);
    return Math.round((1 - normalized) * (height - 24)) + 12; // padding top/bottom
  };

  const secondsMarks = useMemo(() => {
    const marks = [] as number[];
    const total = Math.ceil(totalDuration);
    for (let i = 0; i <= total; i++) marks.push(i);
    return marks;
  }, [totalDuration]);

  const playingSet = useMemo(() => {
    const s = new Set<number>();
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i];
      if (currentTime >= n.time && currentTime <= n.time + n.duration) s.add(i);
    }
    return s;
  }, [notes, currentTime]);

  const playheadX = clamp(currentTime * pps, 0, width);

  return (
    <div ref={containerRef} className="surface-card w-full overflow-hidden" style={{ height }}>
      <svg width={width} height={height} className="block w-full h-full">
        {/* Background grid */}
        <defs>
          <linearGradient id="noteFill" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor={`hsl(var(--brand))`} />
            <stop offset="100%" stopColor={`hsl(var(--brand-2))`} />
          </linearGradient>
          {/* soft shadow for notes to lift them from grid */}
          <filter id="noteShadow" x="-20%" y="-50%" width="140%" height="200%">
            <feDropShadow dx="0" dy="0.4" stdDeviation="0.8" floodColor="#000" floodOpacity="0.35" />
          </filter>
          {/* subtle glow for playhead */}
          <filter id="softGlow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="2.2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          {/* sheen on top of notes */}
          <linearGradient id="noteSheen" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          {/* Optional hatch pattern for black-key notes */}
          <pattern id="blackNoteHatchPR" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="4" height="4" fill="transparent" />
            <line x1="0" y1="0" x2="0" y2="4" stroke="#fff" strokeOpacity="0.22" strokeWidth="0.7" />
          </pattern>
        </defs>

        {/* Inline SVG CSS for micro animations and reduced motion */}
        <style>
          {`
          .active-note-outline { animation: pulse 1.05s ease-in-out infinite; }
          .playhead-pulse { transform-box: fill-box; transform-origin: center; animation: breathe 1.6s ease-in-out infinite; }
          @keyframes pulse { 0%,100% { opacity: .7 } 50% { opacity: 1 } }
          @keyframes breathe { 0%,100% { transform: scale(1); opacity: .65 } 50% { transform: scale(1.22); opacity: .35 } }
          @media (prefers-reduced-motion: reduce) {
            .active-note-outline, .playhead-pulse { animation: none !important; }
          }
        `}
        </style>

        {/* Horizontal key lanes every octave */}
        {Array.from({ length: Math.floor((maxMidi - minMidi) / 12) + 2 }).map((_, idx) => {
          const midi = maxMidi - idx * 12;
          const y = midiToY(midi);
          return (
            <line
              key={`h-${idx}`}
              x1={0}
              x2={width}
              y1={y}
              y2={y}
              stroke="hsl(var(--border))"
              strokeOpacity={0.35}
            />
          );
        })}

        {/* Vertical time markers each second */}
        {secondsMarks.map((s, idx) => (
          <line
            key={`s-${idx}`}
            x1={s * pps}
            x2={s * pps}
            y1={0}
            y2={height}
            stroke="hsl(var(--border))"
            strokeOpacity={s % 4 === 0 ? 0.35 : 0.18}
          />
        ))}

        {/* Progress shading behind playhead for readability */}
        <rect
          x={0}
          y={0}
          width={playheadX}
          height={height}
          fill="currentColor"
          opacity={0.035}
          style={{ mixBlendMode: "soft-light" }}
          pointerEvents="none"
        />

        {/* Notes */}
        {notes.map((n, i) => {
          const x = n.time * pps;
          const w = Math.max(2, n.duration * pps);
          const y = midiToY(n.midi);
          const h = 6;
          const isActive = playingSet.has(i);
          const vel = clamp(n.velocity, 0, 1);
          const baseOpacity = 0.6 + 0.35 * vel;
          const isBlack = isBlackKey(n.midi);
          const noteColor = colorForKeyType(n.midi);
          const edgeColor = isBlack ? "#fff" : "#000";
          const edgeOpacity = isBlack ? 0.18 : 0.22;
          return (
            <g key={i} className="animate-fade-in">
              <rect
                x={x}
                y={y - h / 2}
                width={w}
                height={h}
                rx={3}
                fill={noteColor}
                opacity={baseOpacity}
                filter="url(#noteShadow)"
                pointerEvents="none"
              />
              {/* subtle contrasting left edge for clearer boundaries */}
              <rect
                x={x}
                y={y - h / 2}
                width={Math.min(1, w)}
                height={h}
                fill={edgeColor}
                opacity={edgeOpacity}
                pointerEvents="none"
              />
              {/* optional hatch to make black-key notes unmistakable */}
              {showBlackHatch && isBlack && (
                <rect
                  x={x}
                  y={y - h / 2}
                  width={w}
                  height={h}
                  rx={3}
                  fill="url(#blackNoteHatchPR)"
                  pointerEvents="none"
                />
              )}
              {/* subtle stroke to separate from grid */}
              <rect
                x={x + 0.25}
                y={y - h / 2 + 0.25}
                width={Math.max(0, w - 0.5)}
                height={Math.max(0, h - 0.5)}
                rx={2.5}
                fill="none"
                stroke="hsl(var(--foreground))"
                opacity={0.12}
                pointerEvents="none"
              />
              {/* top sheen */}
              <rect
                x={x + 0.5}
                y={y - h / 2 + 0.5}
                width={Math.max(0, w - 1)}
                height={h * 0.45}
                rx={2}
                fill="url(#noteSheen)"
                pointerEvents="none"
              />
              {isActive && (
                <rect
                  x={x - 0.5}
                  y={y - h / 2 - 1}
                  width={w + 1}
                  height={h + 2}
                  rx={3}
                  fill="none"
                  stroke={noteColor}
                  strokeWidth={1.5}
                  className="active-note-outline"
                />
              )}
            </g>
          );
        })}

        {/* Playhead with glow and breathing dot */}
        <line
          x1={playheadX}
          x2={playheadX}
          y1={0}
          y2={height}
          stroke={`hsl(var(--brand))`}
          strokeWidth={2}
          opacity={0.95}
          filter="url(#softGlow)"
        />
        <circle cx={playheadX} cy={12} r={3} fill={`hsl(var(--brand))`} />
        <circle cx={playheadX} cy={12} r={6} fill={`hsl(var(--brand))`} className="playhead-pulse" opacity={0.4} />
      </svg>
    </div>
  );
};

export default PianoRoll;
