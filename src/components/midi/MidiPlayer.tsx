import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Upload, Play, Pause, Square, Youtube, Loader2, Maximize, Minimize, Music2, GraduationCap,
  SkipBack, SkipForward, RotateCcw, Scissors, Combine, Repeat, Wand2, Keyboard, X, Minus, Plus,
} from "lucide-react";
import { toast } from "sonner";
import * as Tone from "tone";
import { Midi } from "@tonejs/midi";
import PianoCanvas, { type LearnView } from "./PianoCanvas";
import LearnLane from "./LearnLane";
import { PianoNote } from "./PianoRoll";
import { PlaybackEngine, type AutoStopReason } from "./playback";
import {
  autoSegment, densityBins, MIN_SEGMENT, onsetClusters, segmentAt, segmentRange, snapToOnset, storageKey,
} from "./segments";
import { cn } from "@/lib/utils";

const formatTime = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
};
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

const SAMPLE_URLS: Record<string, string> = {
  A0: "A0.mp3", C1: "C1.mp3", "D#1": "Ds1.mp3", "F#1": "Fs1.mp3", A1: "A1.mp3",
  C2: "C2.mp3", "D#2": "Ds2.mp3", "F#2": "Fs2.mp3", A2: "A2.mp3",
  C3: "C3.mp3", "D#3": "Ds3.mp3", "F#3": "Fs3.mp3", A3: "A3.mp3",
  C4: "C4.mp3", "D#4": "Ds4.mp3", "F#4": "Fs4.mp3", A4: "A4.mp3",
  C5: "C5.mp3", "D#5": "Ds5.mp3", "F#5": "Fs5.mp3", A5: "A5.mp3",
  C6: "C6.mp3", "D#6": "Ds6.mp3", "F#6": "Fs6.mp3", A6: "A6.mp3",
  C7: "C7.mp3", "D#7": "Ds7.mp3", "F#7": "Fs7.mp3", A7: "A7.mp3", C8: "C8.mp3",
};

const IconButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }> = ({
  className,
  active,
  ...props
}) => (
  <button
    {...props}
    className={cn(
      "inline-flex h-9 w-9 items-center justify-center rounded-full text-white/80 transition-colors",
      "hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-40",
      active && "bg-white/10 text-white",
      className
    )}
  />
);

/** Thin full-width seek strip that thickens on hover, with a time preview. */
const SeekStrip: React.FC<{
  current: number;
  duration: number;
  onScrub: (t: number) => void;
  onScrubEnd: (t: number) => void;
}> = ({ current, duration, onScrub, onScrubEnd }) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);
  const [hoverX, setHoverX] = useState<number | null>(null);

  const timeAt = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    return clamp((clientX - r.left) / r.width, 0, 1) * duration;
  };
  const pct = duration > 0 ? (current / duration) * 100 : 0;
  const width = ref.current?.getBoundingClientRect().width ?? 1;

  return (
    <div
      ref={ref}
      className="group relative h-4 cursor-pointer touch-none"
      onPointerDown={(e) => {
        if (!duration) return;
        dragging.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        onScrub(timeAt(e.clientX));
      }}
      onPointerMove={(e) => {
        const r = ref.current!.getBoundingClientRect();
        setHoverX(e.clientX - r.left);
        if (dragging.current) onScrub(timeAt(e.clientX));
      }}
      onPointerUp={(e) => {
        if (!dragging.current) return;
        dragging.current = false;
        onScrubEnd(timeAt(e.clientX));
      }}
      onPointerLeave={() => setHoverX(null)}
    >
      <div className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 bg-white/15 transition-all group-hover:h-[6px]">
        <div
          className="h-full bg-gradient-to-r from-[hsl(190_90%_50%)] to-[hsl(45_92%_55%)]"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div
        className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white opacity-0 shadow transition-opacity group-hover:opacity-100"
        style={{ left: `${pct}%` }}
      />
      {hoverX !== null && duration > 0 && (
        <div
          className="pointer-events-none absolute top-full mt-1 -translate-x-1/2 rounded bg-black/80 px-1.5 py-0.5 text-[11px] tabular-nums text-white"
          style={{ left: clamp(hoverX, 20, width - 20) }}
        >
          {formatTime((clamp(hoverX, 0, width) / width) * duration)}
        </div>
      )}
    </div>
  );
};

const SPEEDS = [0.5, 0.6, 0.7, 0.8, 0.9, 1];

const SHORTCUTS: [string, string][] = [
  ["Space", "Play / pause — in Learn mode, replays the segment once it has ended"],
  ["L", "Toggle Learn mode"],
  ["R  or  Enter", "Replay current segment from its start"],
  ["← / →", "Previous / next segment (Learn) · seek 5s (normal)"],
  ["Shift + ← / →", "Nudge 1s"],
  ["S", "Split segment at the playhead (works while playing)"],
  ["M", "Merge segment with the next one"],
  ["A", "Toggle auto-replay"],
  ["− / +", "Practice speed"],
  ["Scroll", "Step through notes while paused"],
  ["Drag lines", "Move segment boundaries (timeline or notes) · Alt = no snapping"],
  ["F", "Fullscreen"],
];

const MidiPlayer: React.FC = () => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const engineRef = useRef<PlaybackEngine>();
  if (!engineRef.current) engineRef.current = new PlaybackEngine();
  const engine = engineRef.current;
  const scrubbingRef = useRef(false);
  const wasPlayingRef = useRef(false);
  const timeRef = useRef(0); // read by the canvas every frame
  const learnRef = useRef<LearnView | null>(null);
  const replayTimer = useRef<ReturnType<typeof setTimeout>>();

  const [fileName, setFileName] = useState<string | null>(null);
  const [notes, setNotes] = useState<PianoNote[]>([]);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [idle, setIdle] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [rate, setRate] = useState(1);
  const [showHelp, setShowHelp] = useState(false);

  // Learn mode
  const [learnMode, setLearnMode] = useState(false);
  const [boundaries, setBoundaries] = useState<number[]>([]);
  const [seg, setSeg] = useState(0);
  const [reps, setReps] = useState<Record<number, number>>({});
  const [autoReplay, setAutoReplay] = useState(false);
  const [replayPending, setReplayPending] = useState(false);

  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStep, setProcessingStep] = useState("");
  const [processingProgress, setProcessingProgress] = useState(0);

  // Latest state for callbacks fired from the engine / timers
  const st = useRef({ learnMode, boundaries, seg, autoReplay, duration, fileName, notes });
  st.current = { learnMode, boundaries, seg, autoReplay, duration, fileName, notes };

  const onsets = useMemo(() => onsetClusters(notes), [notes]);
  const density = useMemo(() => densityBins(notes, duration), [notes, duration]);
  const [segStart, segEnd] = segmentRange(boundaries, seg, duration);

  // ---------- Audio ----------
  useEffect(() => {
    const reverb = new Tone.Reverb({ decay: 2.5, preDelay: 0.01, wet: 0.15 }).toDestination();
    const sampler = new Tone.Sampler(SAMPLE_URLS, undefined, "https://tonejs.github.io/audio/salamander/").connect(reverb);
    sampler.release = 1;
    sampler.volume.value = -8;
    engine.sampler = sampler;
    return () => {
      engine.pause();
      engine.sampler = null;
      sampler.dispose();
      reverb.dispose();
    };
  }, [engine]);

  // Playhead sync: the canvas reads timeRef every frame; React state only drives the UI
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      if (!scrubbingRef.current) {
        const t = engine.time();
        timeRef.current = t;
        setCurrentTime((prev) => (Math.abs(prev - t) > 0.05 || !engine.playing ? t : prev));
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [engine]);

  // Keep the canvas overlay and the engine's stop point in sync with Learn state
  useEffect(() => {
    learnRef.current = learnMode && notes.length ? { boundaries, seg, duration } : null;
    engine.stopAt = learnMode ? segmentRange(boundaries, seg, duration)[1] : null;
  }, [engine, learnMode, boundaries, seg, duration, notes.length]);

  const cancelReplay = useCallback(() => {
    clearTimeout(replayTimer.current);
    setReplayPending(false);
  }, []);

  const startPlay = useCallback(async () => {
    if (!st.current.notes.length) return;
    if (!engine.sampler?.loaded) {
      toast("Loading piano samples…");
      return;
    }
    await engine.play();
    setIsPlaying(true);
  }, [engine]);

  const pause = useCallback(() => {
    cancelReplay();
    engine.pause();
    setIsPlaying(false);
  }, [engine, cancelReplay]);

  const showTime = (t: number) => {
    timeRef.current = t;
    setCurrentTime(t);
  };

  /** Select segment k and park the playhead at its start (optionally play it). */
  const goSegment = useCallback(
    (k: number, play = false) => {
      cancelReplay();
      const { boundaries: b, duration: d } = st.current;
      const kk = clamp(k, 0, b.length);
      const [s, e] = segmentRange(b, kk, d);
      st.current.seg = kk;
      setSeg(kk);
      engine.pause();
      engine.stopAt = e;
      engine.seek(s);
      showTime(s);
      setIsPlaying(false);
      if (play) startPlay();
    },
    [engine, cancelReplay, startPlay]
  );

  // Engine reached the segment end / song end
  const autoStopRef = useRef<(reason: AutoStopReason, at: number) => void>(() => {});
  autoStopRef.current = (reason, at) => {
    setIsPlaying(false);
    showTime(at);
    if (reason !== "segment") return;
    const k = st.current.seg;
    setReps((r) => ({ ...r, [k]: (r[k] ?? 0) + 1 }));
    if (st.current.autoReplay) {
      setReplayPending(true);
      replayTimer.current = setTimeout(() => {
        setReplayPending(false);
        goSegment(st.current.seg, true);
      }, 1200);
    }
  };
  useEffect(() => {
    engine.onAutoStop = (r, at) => autoStopRef.current(r, at);
  }, [engine]);

  const togglePlay = useCallback(() => {
    cancelReplay();
    if (engine.playing) {
      pause();
      return;
    }
    const t = engine.time();
    const { learnMode: lm, boundaries: b, seg: k, duration: d } = st.current;
    if (lm) {
      const [s, e] = segmentRange(b, k, d);
      if (t >= e - 0.02 || t < s - 1e-3) {
        goSegment(k, true); // segment finished (or playhead outside it): replay from its start
        return;
      }
    } else if (t >= d - 0.01) {
      engine.seek(0);
    }
    startPlay();
  }, [engine, pause, goSegment, startPlay, cancelReplay]);

  const seekTo = useCallback(
    (t: number) => {
      cancelReplay();
      const { learnMode: lm, boundaries: b, duration: d } = st.current;
      const target = clamp(t, 0, d || 0);
      if (lm) {
        const k = segmentAt(b, target);
        st.current.seg = k;
        setSeg(k);
        engine.stopAt = segmentRange(b, k, d)[1];
      }
      engine.seek(target);
      showTime(target);
    },
    [engine, cancelReplay]
  );

  const stop = useCallback(() => {
    if (st.current.learnMode) goSegment(st.current.seg);
    else {
      pause();
      seekTo(0);
    }
  }, [goSegment, pause, seekTo]);

  // ---------- Segment editing ----------
  const commitBoundaries = useCallback((next: number[], persist = true) => {
    st.current.boundaries = next;
    setBoundaries(next);
    const { fileName: f, notes: ns } = st.current;
    if (persist && f) localStorage.setItem(storageKey(f, ns), JSON.stringify(next));
  }, []);

  const moveBoundary = useCallback(
    (i: number, t: number, tol: number, free: boolean) => {
      const b = st.current.boundaries;
      const d = st.current.duration;
      const lo = (i === 0 ? 0 : b[i - 1]) + MIN_SEGMENT;
      const hi = (i === b.length - 1 ? d : b[i + 1]) - MIN_SEGMENT;
      const v = clamp(free ? t : snapToOnset(t, onsets, tol), lo, hi);
      if (Math.abs(v - b[i]) < 1e-6) return;
      const next = [...b];
      next[i] = v;
      commitBoundaries(next);
    },
    [onsets, commitBoundaries]
  );

  const removeBoundary = useCallback(
    (i: number) => {
      const b = st.current.boundaries;
      if (i < 0 || i >= b.length) return;
      commitBoundaries(b.filter((_, j) => j !== i));
      setReps((r) => {
        const out: Record<number, number> = {};
        for (const [k, v] of Object.entries(r)) {
          const kk = Number(k);
          if (kk <= i) out[kk] = Math.max(out[kk] ?? 0, v);
          else if (kk === i + 1) out[i] = Math.max(out[i] ?? 0, v);
          else out[kk - 1] = v;
        }
        return out;
      });
      const k = st.current.seg > i ? st.current.seg - 1 : st.current.seg;
      st.current.seg = k;
      setSeg(k);
    },
    [commitBoundaries]
  );

  const splitAtPlayhead = useCallback(() => {
    const b = st.current.boundaries;
    const d = st.current.duration;
    const t = snapToOnset(engine.time(), onsets, 0.15);
    const [s, e] = segmentRange(b, segmentAt(b, t), d);
    if (t - s < MIN_SEGMENT || e - t < MIN_SEGMENT) {
      toast("Too close to an existing boundary");
      return;
    }
    const next = [...b, t].sort((x, y) => x - y);
    const k = next.indexOf(t); // the segment that now ends at t
    commitBoundaries(next);
    setReps((r) => {
      const out: Record<number, number> = {};
      for (const [kk, v] of Object.entries(r)) out[Number(kk) > k ? Number(kk) + 1 : Number(kk)] = v;
      return out;
    });
    st.current.seg = k;
    setSeg(k);
    toast.success(`Segment ${k + 1} now ends here`);
  }, [engine, onsets, commitBoundaries]);

  const resetSegments = useCallback(() => {
    const { fileName: f, notes: ns, duration: d } = st.current;
    if (f) localStorage.removeItem(storageKey(f, ns));
    const next = autoSegment(ns, d);
    commitBoundaries(next, false);
    setReps({});
    goSegment(segmentAt(next, engine.time()));
    toast.success(`Auto-split into ${next.length + 1} segments`);
  }, [engine, commitBoundaries, goSegment]);

  const toggleLearn = useCallback(() => {
    if (!st.current.notes.length) return;
    cancelReplay();
    const on = !st.current.learnMode;
    st.current.learnMode = on;
    setLearnMode(on);
    if (on) goSegment(segmentAt(st.current.boundaries, engine.time()));
    else engine.stopAt = null;
  }, [engine, goSegment, cancelReplay]);

  const changeRate = useCallback(
    (dir: number) => {
      const i = SPEEDS.indexOf(engine.rate);
      const r = SPEEDS[clamp((i < 0 ? SPEEDS.length - 1 : i) + dir, 0, SPEEDS.length - 1)];
      engine.setRate(r);
      setRate(r);
    },
    [engine]
  );

  // ---------- Loading ----------
  const loadMidiFromData = useCallback(
    async (data: ArrayBuffer, name: string) => {
      try {
        const midi = new Midi(data);
        const collected: PianoNote[] = [];
        midi.tracks.forEach((t) =>
          t.notes.forEach((n) => collected.push({ midi: n.midi, time: n.time, duration: n.duration, velocity: n.velocity }))
        );
        collected.sort((a, b) => a.time - b.time);
        const total = collected.reduce((acc, n) => Math.max(acc, n.time + n.duration), 0);
        const title = name.replace(/\.midi?$/i, "");

        cancelReplay();
        engine.setNotes(collected, total);
        let saved: number[] | null = null;
        try {
          saved = JSON.parse(localStorage.getItem(storageKey(title, collected)) ?? "null");
        } catch {
          saved = null;
        }
        const b = Array.isArray(saved) ? saved : autoSegment(collected, total);
        st.current = { ...st.current, notes: collected, duration: total, fileName: title, boundaries: b, seg: 0 };
        setNotes(collected);
        setDuration(total);
        setFileName(title);
        setBoundaries(b);
        setSeg(0);
        setReps({});
        engine.stopAt = st.current.learnMode ? segmentRange(b, 0, total)[1] : null;
        showTime(0);
        setIsPlaying(false);
        toast.success(saved ? "MIDI loaded — your saved segments were restored" : "MIDI loaded — press Space to play, L to learn");
      } catch (err) {
        console.error(err);
        toast.error("Failed to load MIDI file.");
      }
    },
    [engine, cancelReplay]
  );

  const processYouTubeUrl = useCallback(() => {
    if (!youtubeUrl.trim()) {
      toast.error("Please enter a YouTube URL");
      return;
    }
    setIsProcessing(true);
    setProcessingStep("Initializing...");
    setProcessingProgress(0);

    const eventSource = new EventSource(`/process?url=${encodeURIComponent(youtubeUrl)}`);
    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "progress") {
        setProcessingStep(data.step);
        setProcessingProgress(data.progress || 0);
      } else if (data.type === "complete") {
        eventSource.close();
        fetch(`/download/${data.midiPath}`)
          .then((r) => r.arrayBuffer())
          .then((ab) => {
            loadMidiFromData(ab, `${data.title || "YouTube"}.mid`);
            setYoutubeUrl("");
          })
          .catch((err) => {
            console.error(err);
            toast.error("Failed to download processed MIDI");
          })
          .finally(() => setIsProcessing(false));
      } else if (data.type === "error") {
        toast.error(data.message || "Processing failed");
        setIsProcessing(false);
        eventSource.close();
      }
    };
    eventSource.onerror = () => {
      toast.error("Connection lost to processing server");
      setIsProcessing(false);
      eventSource.close();
    };
  }, [youtubeUrl, loadMidiFromData]);

  const loadFile = useCallback(
    async (f: File | undefined) => {
      if (!f) return;
      if (!/\.midi?$/i.test(f.name)) {
        toast.error("Please drop a .mid or .midi file");
        return;
      }
      loadMidiFromData(await f.arrayBuffer(), f.name);
    },
    [loadMidiFromData]
  );

  // ---------- Seek strip / wheel ----------
  const handleScrub = useCallback(
    (val: number) => {
      if (!scrubbingRef.current) {
        scrubbingRef.current = true;
        wasPlayingRef.current = engine.playing;
        if (engine.playing) pause();
      }
      showTime(val);
    },
    [engine, pause]
  );

  const handleScrubEnd = useCallback(
    (val: number) => {
      seekTo(val);
      scrubbingRef.current = false;
      if (wasPlayingRef.current) startPlay();
    },
    [seekTo, startPlay]
  );

  const handleWheelSeek = useCallback(
    (delta: number) => {
      if (engine.playing || !st.current.notes.length) return;
      seekTo(engine.time() + delta);
    },
    [engine, seekTo]
  );

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  }, []);

  useEffect(() => {
    const onFs = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  // ---------- Keyboard shortcuts ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || e.ctrlKey || e.metaKey) return;
      const lm = st.current.learnMode;
      const k = e.key;
      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
      } else if (k === "ArrowRight" || k === "ArrowLeft") {
        e.preventDefault();
        const dir = k === "ArrowRight" ? 1 : -1;
        if (e.shiftKey) seekTo(engine.time() + dir);
        else if (lm) goSegment(st.current.seg + dir);
        else seekTo(engine.time() + 5 * dir);
      } else if (k === "Enter" || k === "r" || k === "R") {
        e.preventDefault();
        if (lm) goSegment(st.current.seg, true);
        else {
          seekTo(0);
          startPlay();
        }
      } else if (k === "l" || k === "L") toggleLearn();
      else if ((k === "s" || k === "S") && lm) splitAtPlayhead();
      else if ((k === "m" || k === "M") && lm) removeBoundary(st.current.seg);
      else if (k === "a" || k === "A") setAutoReplay((v) => !v);
      else if (k === "-" || k === "_") changeRate(-1);
      else if (k === "=" || k === "+") changeRate(1);
      else if (k === "f" || k === "F") toggleFullscreen();
      else if (k === "?") setShowHelp((v) => !v);
      else if (k === "Escape") setShowHelp(false);
      else if (k === "Home") {
        if (lm) goSegment(0);
        else seekTo(0);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [engine, togglePlay, seekTo, goSegment, startPlay, toggleLearn, splitAtPlayhead, removeBoundary, changeRate, toggleFullscreen]);

  // Auto-hide the top bar while playing and the mouse is still (kept visible in Learn mode)
  const idleTimer = useRef<ReturnType<typeof setTimeout>>();
  const poke = useCallback(() => {
    setIdle(false);
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setIdle(true), 2500);
  }, []);
  useEffect(() => () => clearTimeout(idleTimer.current), []);
  useEffect(() => () => clearTimeout(replayTimer.current), []);
  const showChrome = !isPlaying || !idle || learnMode;

  const hasSong = notes.length > 0;
  const atSegEnd = learnMode && !isPlaying && currentTime >= segEnd - 0.02;

  let status: string | null = null;
  if (hasSong && !isProcessing) {
    if (replayPending) status = "Replaying…";
    else if (learnMode && atSegEnd) status = `Segment ${seg + 1} done ×${reps[seg] ?? 0}  ·  Space: replay  ·  →: next`;
    else if (learnMode && !isPlaying) status = `Segment ${seg + 1}  ·  Space: play  ·  scroll to inspect`;
    else if (!isPlaying && currentTime > 0) status = "Paused  ·  scroll to step through notes";
  }

  return (
    <div
      className={cn("fixed inset-0 select-none overflow-hidden bg-[#0a0c11] text-white", !showChrome && "cursor-none")}
      onMouseMove={poke}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        loadFile(e.dataTransfer.files?.[0]);
      }}
    >
      <PianoCanvas
        notes={notes}
        timeRef={timeRef}
        learnRef={learnRef}
        onWheelSeek={handleWheelSeek}
        onBoundaryDrag={moveBoundary}
        className="absolute inset-0"
      />

      <input
        ref={inputRef}
        type="file"
        accept=".mid,.midi"
        onChange={(e) => {
          loadFile(e.target.files?.[0]);
          e.target.value = "";
        }}
        className="hidden"
      />

      {/* ---------- Top bar ---------- */}
      <header
        className={cn(
          "absolute inset-x-0 top-0 z-20 transition-all duration-300",
          showChrome ? "translate-y-0 opacity-100" : "pointer-events-none -translate-y-3 opacity-0"
        )}
      >
        <div className="border-b border-white/5 bg-black/60 backdrop-blur-md">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 px-4 py-2">
            {/* Left: brand + song */}
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex items-center gap-2 font-semibold tracking-tight">
                <Music2 className="h-5 w-5 text-[hsl(190_90%_55%)]" />
                <span className="hidden sm:inline">Luna Melody</span>
              </div>
              {fileName && (
                <>
                  <span className="text-white/20">/</span>
                  <span className="truncate text-sm text-white/70" title={fileName}>
                    {fileName}
                  </span>
                </>
              )}
            </div>

            {/* Center: transport */}
            <div className="flex items-center gap-1">
              <IconButton onClick={stop} disabled={!hasSong} aria-label="Stop" title="Stop">
                <Square className="h-4 w-4" />
              </IconButton>
              <button
                onClick={togglePlay}
                disabled={!hasSong}
                aria-label={isPlaying ? "Pause" : "Play"}
                title="Play / Pause (Space)"
                className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white text-black transition-transform hover:scale-105 disabled:opacity-40"
              >
                {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="ml-0.5 h-5 w-5" />}
              </button>
              <span className="ml-2 w-24 text-xs tabular-nums text-white/60">
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>
              <div className="ml-1 flex items-center rounded-full border border-white/10 bg-white/5" title="Practice speed (− / +)">
                <button onClick={() => changeRate(-1)} className="px-1.5 py-1 text-white/60 hover:text-white" aria-label="Slower">
                  <Minus className="h-3 w-3" />
                </button>
                <span className={cn("w-9 text-center text-xs tabular-nums", rate < 1 ? "text-[hsl(45_92%_65%)]" : "text-white/70")}>
                  {Math.round(rate * 100)}%
                </span>
                <button onClick={() => changeRate(1)} className="px-1.5 py-1 text-white/60 hover:text-white" aria-label="Faster">
                  <Plus className="h-3 w-3" />
                </button>
              </div>
            </div>

            {/* Right: sources + modes */}
            <div className="flex items-center justify-end gap-2">
              <form
                className="hidden items-center rounded-full border border-white/10 bg-white/5 pl-3 focus-within:border-white/30 xl:flex"
                onSubmit={(e) => {
                  e.preventDefault();
                  processYouTubeUrl();
                }}
              >
                <Youtube className="h-4 w-4 shrink-0 text-red-400" />
                <input
                  value={youtubeUrl}
                  onChange={(e) => setYoutubeUrl(e.target.value)}
                  disabled={isProcessing}
                  placeholder="Paste a YouTube link…"
                  className="w-56 bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-white/35"
                />
                <button
                  type="submit"
                  disabled={isProcessing || !youtubeUrl.trim()}
                  className="mr-1 rounded-full px-3 py-1 text-xs font-medium text-white/80 hover:bg-white/10 disabled:opacity-40"
                >
                  {isProcessing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Transcribe"}
                </button>
              </form>
              <button
                onClick={toggleLearn}
                disabled={!hasSong}
                title="Learn mode (L)"
                className={cn(
                  "inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors disabled:opacity-40",
                  learnMode
                    ? "bg-[hsl(45_92%_55%)] text-black hover:bg-[hsl(45_92%_62%)]"
                    : "border border-white/10 bg-white/5 text-white/80 hover:bg-white/10"
                )}
              >
                <GraduationCap className="h-4 w-4" />
                Learn
              </button>
              <IconButton onClick={() => inputRef.current?.click()} disabled={isProcessing} title="Open MIDI file" aria-label="Open MIDI file">
                <Upload className="h-4 w-4" />
              </IconButton>
              <IconButton onClick={() => setShowHelp((v) => !v)} active={showHelp} title="Shortcuts (?)" aria-label="Keyboard shortcuts">
                <Keyboard className="h-4 w-4" />
              </IconButton>
              <IconButton onClick={toggleFullscreen} title="Fullscreen (F)" aria-label="Toggle fullscreen">
                {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
              </IconButton>
            </div>
          </div>
          <div className="px-2">
            <SeekStrip current={currentTime} duration={duration} onScrub={handleScrub} onScrubEnd={handleScrubEnd} />
          </div>

          {/* ---------- Learn toolbar + segment lane ---------- */}
          {learnMode && hasSong && (
            <div className="space-y-2 px-4 pb-3 pt-1">
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-sm">
                <div className="flex min-w-0 items-baseline gap-2">
                  <span className="font-medium">
                    Segment {seg + 1}
                    <span className="text-white/40"> / {boundaries.length + 1}</span>
                  </span>
                  <span className="text-xs tabular-nums text-white/45">
                    {formatTime(segStart)} – {formatTime(segEnd)} · {(segEnd - segStart).toFixed(1)}s
                  </span>
                  {(reps[seg] ?? 0) > 0 && (
                    <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-xs tabular-nums text-[hsl(45_92%_70%)]">
                      ×{reps[seg]}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <IconButton onClick={() => goSegment(seg - 1)} disabled={seg === 0} title="Previous segment (←)" aria-label="Previous segment">
                    <SkipBack className="h-4 w-4" />
                  </IconButton>
                  <button
                    onClick={() => goSegment(seg, true)}
                    title="Replay segment (R)"
                    className="inline-flex h-8 items-center gap-1.5 rounded-full bg-white/10 px-3 text-xs font-medium hover:bg-white/20"
                  >
                    <RotateCcw className="h-3.5 w-3.5" /> Replay
                  </button>
                  <IconButton
                    onClick={() => goSegment(seg + 1)}
                    disabled={seg >= boundaries.length}
                    title="Next segment (→)"
                    aria-label="Next segment"
                  >
                    <SkipForward className="h-4 w-4" />
                  </IconButton>
                </div>
                <div className="flex items-center justify-end gap-1 text-xs">
                  <button
                    onClick={splitAtPlayhead}
                    title="Split at playhead (S)"
                    className="inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-white/70 hover:bg-white/10 hover:text-white"
                  >
                    <Scissors className="h-3.5 w-3.5" /> Split
                  </button>
                  <button
                    onClick={() => removeBoundary(seg)}
                    disabled={seg >= boundaries.length}
                    title="Merge with next segment (M)"
                    className="inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-30"
                  >
                    <Combine className="h-3.5 w-3.5" /> Merge
                  </button>
                  <button
                    onClick={() => setAutoReplay((v) => !v)}
                    title="Auto-replay the segment after it ends (A)"
                    className={cn(
                      "inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 transition-colors",
                      autoReplay ? "bg-cyan-400/20 text-[hsl(190_90%_70%)]" : "text-white/70 hover:bg-white/10 hover:text-white"
                    )}
                  >
                    <Repeat className="h-3.5 w-3.5" /> Auto-replay
                  </button>
                  <button
                    onClick={resetSegments}
                    title="Re-generate segments automatically"
                    className="inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-white/70 hover:bg-white/10 hover:text-white"
                  >
                    <Wand2 className="h-3.5 w-3.5" /> Auto-split
                  </button>
                </div>
              </div>
              <LearnLane
                duration={duration}
                boundaries={boundaries}
                seg={seg}
                reps={reps}
                density={density}
                currentTime={currentTime}
                onSelect={(k) => goSegment(k)}
                onMoveBoundary={moveBoundary}
                onRemoveBoundary={removeBoundary}
              />
            </div>
          )}
        </div>

        {status && (
          <div className="pointer-events-none absolute left-1/2 top-full mt-3 -translate-x-1/2 whitespace-nowrap rounded-full border border-white/10 bg-black/60 px-3 py-1 text-xs text-white/75 backdrop-blur">
            {status}
          </div>
        )}
      </header>

      {/* ---------- Shortcuts panel ---------- */}
      {showHelp && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/50 p-6" onClick={() => setShowHelp(false)}>
          <div
            className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#0f1218]/95 p-5 shadow-2xl backdrop-blur-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold">Keyboard shortcuts</h2>
              <IconButton onClick={() => setShowHelp(false)} aria-label="Close">
                <X className="h-4 w-4" />
              </IconButton>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              {SHORTCUTS.map(([key, desc]) => (
                <React.Fragment key={key}>
                  <dt>
                    <kbd className="whitespace-nowrap rounded border border-white/15 bg-white/5 px-1.5 py-0.5 font-mono text-xs">{key}</kbd>
                  </dt>
                  <dd className="text-white/65">{desc}</dd>
                </React.Fragment>
              ))}
            </dl>
          </div>
        </div>
      )}

      {/* ---------- Empty / processing panel ---------- */}
      {(!hasSong || isProcessing) && (
        <div className="absolute inset-0 z-10 flex items-center justify-center p-6" style={{ paddingBottom: "22vh" }}>
          <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-black/60 p-6 shadow-2xl backdrop-blur-xl">
            {isProcessing ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <Loader2 className="h-5 w-5 animate-spin text-[hsl(190_90%_55%)]" />
                  <span className="text-sm text-white/80">{processingStep}</span>
                  <span className="ml-auto text-xs tabular-nums text-white/50">{Math.round(processingProgress)}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full bg-gradient-to-r from-[hsl(190_90%_50%)] to-[hsl(45_92%_55%)] transition-all"
                    style={{ width: `${processingProgress}%` }}
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-5">
                <div>
                  <h1 className="text-2xl font-semibold tracking-tight">Luna Melody</h1>
                  <p className="mt-1 text-sm text-white/55">Transcribe piano from YouTube, or open a MIDI file.</p>
                </div>
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    processYouTubeUrl();
                  }}
                >
                  <div className="flex flex-1 items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 focus-within:border-white/30">
                    <Youtube className="h-4 w-4 shrink-0 text-red-400" />
                    <input
                      autoFocus
                      value={youtubeUrl}
                      onChange={(e) => setYoutubeUrl(e.target.value)}
                      placeholder="https://www.youtube.com/watch?v=…"
                      className="w-full bg-transparent py-2.5 text-sm outline-none placeholder:text-white/30"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={!youtubeUrl.trim()}
                    className="rounded-lg bg-white px-4 text-sm font-medium text-black transition hover:bg-white/90 disabled:opacity-40"
                  >
                    Transcribe
                  </button>
                </form>
                <div className="flex items-center gap-3 text-xs text-white/35">
                  <div className="h-px flex-1 bg-white/10" /> or <div className="h-px flex-1 bg-white/10" />
                </div>
                <button
                  onClick={() => inputRef.current?.click()}
                  className={cn(
                    "flex w-full flex-col items-center gap-1 rounded-lg border border-dashed border-white/15 py-5 text-sm text-white/60 transition hover:border-white/30 hover:bg-white/5",
                    dragOver && "border-[hsl(190_90%_55%)] bg-white/5"
                  )}
                >
                  <Upload className="h-5 w-5" />
                  Drop a .mid file here or click to browse
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {dragOver && hasSong && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center border-2 border-dashed border-[hsl(190_90%_55%)] bg-black/50 text-lg">
          Drop MIDI file to load
        </div>
      )}
    </div>
  );
};

export default MidiPlayer;
