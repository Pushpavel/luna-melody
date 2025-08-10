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
};

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export const PianoRoll: React.FC<PianoRollProps> = ({
  notes,
  currentTime,
  totalDuration,
  height = 420,
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
        </defs>

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

        {/* Notes */}
        {notes.map((n, i) => {
          const x = n.time * pps;
          const w = Math.max(2, n.duration * pps);
          const y = midiToY(n.midi);
          const h = 6;
          const isActive = playingSet.has(i);
          return (
            <g key={i} className="animate-fade-in">
              <rect
                x={x}
                y={y - h / 2}
                width={w}
                height={h}
                rx={3}
                fill="url(#noteFill)"
                opacity={0.65 + 0.35 * clamp(n.velocity, 0, 1)}
              />
              {isActive && (
                <rect
                  x={x - 0.5}
                  y={y - h / 2 - 1}
                  width={w + 1}
                  height={h + 2}
                  rx={3}
                  fill="none"
                  stroke={`hsl(var(--brand-2))`}
                  strokeWidth={1.5}
                />
              )}
            </g>
          );
        })}

        {/* Playhead */}
        <line
          x1={playheadX}
          x2={playheadX}
          y1={0}
          y2={height}
          stroke={`hsl(var(--brand))`}
          strokeWidth={2}
          opacity={0.9}
        />
        <circle cx={playheadX} cy={12} r={3} fill={`hsl(var(--brand))`} />
      </svg>
    </div>
  );
};

export default PianoRoll;
