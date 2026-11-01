import React, { useCallback, useEffect, useRef, useState } from "react";
import { Upload, Play, Pause, Square, Youtube, Loader2, Maximize, Minimize, Music2 } from "lucide-react";
import { toast } from "sonner";
import * as Tone from "tone";
import { Midi } from "@tonejs/midi";
import PianoCanvas from "./PianoCanvas";
import { PianoNote } from "./PianoRoll";
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

const MidiPlayer: React.FC = () => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const synthRef = useRef<Tone.Sampler | null>(null);
  const scrubbingRef = useRef(false);
  const wasPlayingRef = useRef(false);
  const timeRef = useRef(0); // read by the canvas every frame

  const [fileName, setFileName] = useState<string | null>(null);
  const [notes, setNotes] = useState<PianoNote[]>([]);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [samplesLoaded, setSamplesLoaded] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [idle, setIdle] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStep, setProcessingStep] = useState("");
  const [processingProgress, setProcessingProgress] = useState(0);

  // ---------- Audio ----------
  useEffect(() => {
    const reverb = new Tone.Reverb({ decay: 2.5, preDelay: 0.01, wet: 0.15 }).toDestination();
    const sampler = new Tone.Sampler(SAMPLE_URLS, () => setSamplesLoaded(true), "https://tonejs.github.io/audio/salamander/").connect(reverb);
    sampler.release = 1;
    sampler.volume.value = -8;
    synthRef.current = sampler;
    return () => {
      Tone.Transport.stop();
      Tone.Transport.cancel(0);
      sampler.dispose();
      reverb.dispose();
      synthRef.current = null;
    };
  }, []);

  // Sync playhead: the canvas reads timeRef every frame; React state is only for the UI text/bar
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      if (!scrubbingRef.current) {
        let t = Math.max(0, Tone.Transport.seconds);
        if (duration > 0 && t >= duration - 0.001) {
          t = duration;
          if (Tone.Transport.state === "started") {
            Tone.Transport.pause();
            setIsPlaying(false);
          }
        }
        timeRef.current = t;
        setCurrentTime((prev) => (Math.abs(prev - t) > 0.05 || t === 0 || t === duration ? t : prev));
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [duration]);

  const loadMidiFromData = useCallback(async (data: ArrayBuffer, name: string) => {
    try {
      const midi = new Midi(data);
      const collected: PianoNote[] = [];
      midi.tracks.forEach((t) =>
        t.notes.forEach((n) => collected.push({ midi: n.midi, time: n.time, duration: n.duration, velocity: n.velocity }))
      );
      collected.sort((a, b) => a.time - b.time);
      const total = collected.reduce((acc, n) => Math.max(acc, n.time + n.duration), 0);

      Tone.Transport.stop();
      Tone.Transport.cancel(0);
      Tone.Transport.position = 0;
      synthRef.current?.releaseAll();
      timeRef.current = 0;
      setCurrentTime(0);
      setNotes(collected);
      setDuration(total);
      setFileName(name.replace(/\.midi?$/i, ""));
      setIsPlaying(false);
      toast.success("MIDI loaded — press Space to play");
    } catch (err) {
      console.error(err);
      toast.error("Failed to load MIDI file.");
    }
  }, []);

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

  // ---------- Transport ----------
  const scheduleNotes = useCallback(() => {
    Tone.Transport.cancel(0);
    notes.forEach((n) => {
      Tone.Transport.schedule((time) => {
        synthRef.current?.triggerAttackRelease(Tone.Frequency(n.midi, "midi").toNote(), n.duration, time, n.velocity);
      }, n.time);
    });
  }, [notes]);

  const onPlay = useCallback(async () => {
    if (!notes.length) return;
    await Tone.start();
    if (!samplesLoaded) {
      toast("Loading piano samples…");
      return;
    }
    if (timeRef.current >= duration - 0.01) Tone.Transport.seconds = 0;
    if (Tone.Transport.state === "stopped") scheduleNotes();
    Tone.Transport.start();
    setIsPlaying(true);
  }, [notes.length, scheduleNotes, samplesLoaded, duration]);

  const onPause = useCallback(() => {
    Tone.Transport.pause();
    synthRef.current?.releaseAll();
    setIsPlaying(false);
  }, []);

  const onStop = useCallback(() => {
    Tone.Transport.stop();
    Tone.Transport.position = 0;
    synthRef.current?.releaseAll();
    timeRef.current = 0;
    setCurrentTime(0);
    setIsPlaying(false);
  }, []);

  const seekTo = useCallback(
    (t: number) => {
      const target = clamp(t, 0, duration || 0);
      Tone.Transport.seconds = target;
      timeRef.current = target;
      setCurrentTime(target);
    },
    [duration]
  );

  const handleScrub = useCallback(
    (val: number) => {
      if (!scrubbingRef.current) {
        scrubbingRef.current = true;
        wasPlayingRef.current = isPlaying;
        if (isPlaying) onPause();
      }
      timeRef.current = val;
      setCurrentTime(val);
    },
    [isPlaying, onPause]
  );

  const handleScrubEnd = useCallback(
    (val: number) => {
      seekTo(val);
      if (Tone.Transport.state === "stopped") scheduleNotes();
      if (wasPlayingRef.current) {
        Tone.Transport.start();
        setIsPlaying(true);
      }
      scrubbingRef.current = false;
    },
    [seekTo, scheduleNotes]
  );

  // Mouse wheel over the notes scrubs through time while paused
  const handleWheelSeek = useCallback(
    (delta: number) => {
      if (isPlaying || !notes.length) return;
      seekTo(timeRef.current + delta);
    },
    [isPlaying, notes.length, seekTo]
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

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.code === "Space") {
        e.preventDefault();
        if (isPlaying) onPause();
        else onPlay();
      } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        const step = (e.shiftKey ? 1 : 5) * (e.key === "ArrowRight" ? 1 : -1);
        seekTo(timeRef.current + step);
      } else if (e.key === "f" || e.key === "F") {
        toggleFullscreen();
      } else if (e.key === "Home") {
        seekTo(0);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isPlaying, onPause, onPlay, seekTo, toggleFullscreen]);

  // Auto-hide the top bar while playing and the mouse is still
  const idleTimer = useRef<ReturnType<typeof setTimeout>>();
  const poke = useCallback(() => {
    setIdle(false);
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setIdle(true), 2500);
  }, []);
  useEffect(() => () => clearTimeout(idleTimer.current), []);
  const showChrome = !isPlaying || !idle;

  const hasSong = notes.length > 0;

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
      <PianoCanvas notes={notes} timeRef={timeRef} onWheelSeek={handleWheelSeek} className="absolute inset-0" />

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
        <div className="border-b border-white/5 bg-black/55 backdrop-blur-md">
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
              <IconButton onClick={onStop} disabled={!hasSong} aria-label="Stop" title="Stop (Home)">
                <Square className="h-4 w-4" />
              </IconButton>
              <button
                onClick={isPlaying ? onPause : onPlay}
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
            </div>

            {/* Right: sources + fullscreen */}
            <div className="flex items-center justify-end gap-2">
              <form
                className="hidden items-center rounded-full border border-white/10 bg-white/5 pl-3 focus-within:border-white/30 md:flex"
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
                  className="w-56 bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-white/35 lg:w-72"
                />
                <button
                  type="submit"
                  disabled={isProcessing || !youtubeUrl.trim()}
                  className="mr-1 rounded-full px-3 py-1 text-xs font-medium text-white/80 hover:bg-white/10 disabled:opacity-40"
                >
                  {isProcessing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Transcribe"}
                </button>
              </form>
              <IconButton onClick={() => inputRef.current?.click()} disabled={isProcessing} title="Open MIDI file" aria-label="Open MIDI file">
                <Upload className="h-4 w-4" />
              </IconButton>
              <IconButton onClick={toggleFullscreen} title="Fullscreen (F)" aria-label="Toggle fullscreen">
                {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
              </IconButton>
            </div>
          </div>
          <div className="px-2">
            <SeekStrip current={currentTime} duration={duration} onScrub={handleScrub} onScrubEnd={handleScrubEnd} />
          </div>
        </div>
      </header>

      {/* Paused badge so the frozen frame is clearly a paused state */}
      {hasSong && !isPlaying && currentTime > 0 && !isProcessing && (
        <div className="pointer-events-none absolute left-1/2 top-24 z-10 -translate-x-1/2 rounded-full border border-white/10 bg-black/50 px-3 py-1 text-xs text-white/70 backdrop-blur">
          Paused · scroll to step through notes
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
