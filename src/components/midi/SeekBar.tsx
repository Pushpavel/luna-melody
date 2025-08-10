import React, { useMemo } from "react";
import { Slider } from "@/components/ui/slider";

export type SeekBarProps = {
  current: number;
  duration: number;
  onScrub?: (value: number) => void;
  onScrubEnd?: (value: number) => void;
  className?: string;
};

const formatTime = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
};

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

const SeekBar: React.FC<SeekBarProps> = ({ current, duration, onScrub, onScrubEnd, className }) => {
  const value = useMemo(() => [clamp(current, 0, duration || 0)], [current, duration]);
  const max = Math.max(0.01, duration || 0.01);
  const pct = duration > 0 ? (value[0] / duration) * 100 : 0;

  // Position helper for the floating bubble: center normally, but align to edges near 0%/100%
  const { leftStyle, translateClass } = useMemo(() => {
    const anchor = pct < 8 ? "left" : pct > 92 ? "right" : "center";
    const left = anchor === "left" ? "0%" : anchor === "right" ? "100%" : `${pct}%`;
    const translate = anchor === "center" ? "-translate-x-1/2" : anchor === "right" ? "-translate-x-full" : "";
    return { leftStyle: left, translateClass: translate };
  }, [pct]);

  return (
    <div className={className}>
      <div className="relative group">
        {/* Floating time bubble above thumb on hover/focus */}
        <div
          className={`pointer-events-none absolute bottom-full mb-1.5 z-10 select-none ${translateClass}`}
          style={{ left: leftStyle }}
          aria-hidden
        >
          <div className="rounded-md border border-border bg-popover text-popover-foreground px-2 py-1 text-xs leading-none shadow-md backdrop-blur-sm opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
            {formatTime(current)}
          </div>
        </div>
        {/* Slider without current/total tooltip */}
        <Slider
          value={value}
          max={max}
          step={0.01}
          onValueChange={(v) => onScrub?.(v[0] ?? 0)}
          // @ts-ignore radix supplies onValueCommit on Root
          onValueCommit={(v: number[]) => onScrubEnd?.(v[0] ?? 0)}
          aria-label="Seek"
          className="group"
        />
      </div>
      {/* Static times at the bottom */}
      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground px-1">
        <span>{formatTime(current)}</span>
        <span>{formatTime(duration)}</span>
      </div>
    </div>
  );
};

export default SeekBar;
