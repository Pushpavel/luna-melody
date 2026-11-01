import React, { useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { segmentRange } from "./segments";

const fmt = (s: number) => {
  const v = Math.max(0, s);
  return `${Math.floor(v / 60)}:${(v % 60).toFixed(1).padStart(4, "0")}`;
};

type Props = {
  duration: number;
  boundaries: number[];
  seg: number;
  reps: Record<number, number>;
  density: number[];
  currentTime: number;
  onSelect: (k: number) => void;
  /** tol = snapping tolerance in seconds; free = bypass snapping */
  onMoveBoundary: (i: number, t: number, tol: number, free: boolean) => void;
  onRemoveBoundary: (i: number) => void;
};

/**
 * Timeline of practice segments. Click a block to select it, drag the
 * handles between blocks to move a boundary, double-click a handle to merge.
 */
const LearnLane: React.FC<Props> = ({
  duration,
  boundaries,
  seg,
  reps,
  density,
  currentTime,
  onSelect,
  onMoveBoundary,
  onRemoveBoundary,
}) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const pct = (t: number) => `${(t / Math.max(1e-6, duration)) * 100}%`;

  const densityPath = useMemo(() => {
    const n = density.length;
    if (!n) return "";
    let d = "M0,1";
    density.forEach((v, i) => {
      d += ` L${i / n},${1 - v * 0.9} L${(i + 1) / n},${1 - v * 0.9}`;
    });
    return d + " L1,1 Z";
  }, [density]);

  const timeAt = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    return ((clientX - r.left) / r.width) * duration;
  };
  const tolerance = () => (10 / Math.max(1, ref.current!.getBoundingClientRect().width)) * duration;

  const segCount = boundaries.length + 1;

  return (
    <div ref={ref} className="relative h-9 select-none overflow-visible rounded-md bg-white/[0.03]">
      <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 1 1" preserveAspectRatio="none">
        <path d={densityPath} fill="rgba(255,255,255,0.07)" />
      </svg>

      {Array.from({ length: segCount }, (_, k) => {
        const [s, e] = segmentRange(boundaries, k, duration);
        const active = k === seg;
        const r = reps[k] ?? 0;
        return (
          <button
            key={k}
            onClick={() => onSelect(k)}
            title={`Segment ${k + 1}: ${fmt(s)} – ${fmt(e)}`}
            className={cn(
              "absolute inset-y-0 flex items-center justify-center gap-1 overflow-hidden border-x border-transparent text-[11px] tabular-nums transition-colors",
              active
                ? "z-[1] rounded-sm border-amber-400/60 bg-amber-400/20 text-white ring-1 ring-amber-400/70"
                : "text-white/45 hover:bg-white/[0.07] hover:text-white/80"
            )}
            style={{ left: pct(s), width: pct(e - s) }}
          >
            <span className="font-medium">{k + 1}</span>
            {r > 0 && <span className={cn("text-[10px]", active ? "text-[hsl(45_92%_70%)]" : "text-white/35")}>×{r}</span>}
          </button>
        );
      })}

      {/* playhead */}
      <div className="pointer-events-none absolute inset-y-0 z-[2] w-px bg-white/80" style={{ left: pct(currentTime) }} />

      {/* draggable boundaries */}
      {boundaries.map((b, i) => (
        <div
          key={i}
          className="group absolute inset-y-[-4px] z-[3] w-3 -translate-x-1/2 cursor-ew-resize touch-none"
          style={{ left: pct(b) }}
          title="Drag to move · double-click to merge · Alt = no snapping"
          onPointerDown={(e) => {
            e.stopPropagation();
            e.currentTarget.setPointerCapture(e.pointerId);
            setDragging(i);
          }}
          onPointerMove={(e) => {
            if (dragging !== i) return;
            onMoveBoundary(i, timeAt(e.clientX), tolerance(), e.altKey);
          }}
          onPointerUp={() => setDragging(null)}
          onDoubleClick={() => onRemoveBoundary(i)}
        >
          <div
            className={cn(
              "absolute inset-y-1 left-1/2 w-[2px] -translate-x-1/2 rounded-full transition-colors",
              dragging === i ? "bg-white" : "bg-white/40 group-hover:bg-white"
            )}
          />
          <div className="absolute left-1/2 top-0 h-2 w-2 -translate-x-1/2 rotate-45 rounded-[1px] bg-white/70 opacity-0 transition-opacity group-hover:opacity-100" />
          {dragging === i && (
            <div className="absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap rounded bg-black/85 px-1.5 py-0.5 text-[11px] tabular-nums">
              {fmt(b)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

export default LearnLane;
