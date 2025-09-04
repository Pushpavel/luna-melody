import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Upload, Play, Pause, Square, Youtube, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import FallingPiano from "./FallingPiano";
import { PianoNote } from "./PianoRoll";
import { toast } from "sonner";
import SeekBar from "./SeekBar";

// Tone.js and @tonejs/midi imports
import * as Tone from "tone";
import { Midi } from "@tonejs/midi";

const formatTime = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
};

const MidiPlayer: React.FC = () => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const synthRef = useRef<Tone.Sampler | null>(null);
  const reverbRef = useRef<Tone.Reverb | null>(null);
  const scheduledRef = useRef<number[]>([]);
  const scrubbingRef = useRef(false);
  const wasPlayingRef = useRef(false);

  const [fileName, setFileName] = useState<string | null>(null);
  const [notes, setNotes] = useState<PianoNote[]>([]);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [samplesLoaded, setSamplesLoaded] = useState(false);

  // YouTube processing state
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStep, setProcessingStep] = useState("");
  const [processingProgress, setProcessingProgress] = useState(0);

  // Initialize synth
  useEffect(() => {
    const reverb = new Tone.Reverb({ decay: 2.5, preDelay: 0.01, wet: 0.15 }).toDestination();
    reverbRef.current = reverb;

    const sampler = new Tone.Sampler(
      {
        A0: "A0.mp3",
        C1: "C1.mp3",
        "D#1": "Ds1.mp3",
        "F#1": "Fs1.mp3",
        A1: "A1.mp3",
        C2: "C2.mp3",
        "D#2": "Ds2.mp3",
        "F#2": "Fs2.mp3",
        A2: "A2.mp3",
        C3: "C3.mp3",
        "D#3": "Ds3.mp3",
        "F#3": "Fs3.mp3",
        A3: "A3.mp3",
        C4: "C4.mp3",
        "D#4": "Ds4.mp3",
        "F#4": "Fs4.mp3",
        A4: "A4.mp3",
        C5: "C5.mp3",
        "D#5": "Ds5.mp3",
        "F#5": "Fs5.mp3",
        A5: "A5.mp3",
        C6: "C6.mp3",
        "D#6": "Ds6.mp3",
        "F#6": "Fs6.mp3",
        A6: "A6.mp3",
        C7: "C7.mp3",
        "D#7": "Ds7.mp3",
        "F#7": "Fs7.mp3",
        A7: "A7.mp3",
        C8: "C8.mp3",
      },
      () => {
        setSamplesLoaded(true);
      },
      "https://tonejs.github.io/audio/salamander/"
    ).connect(reverb);

    sampler.release = 1;
    sampler.volume.value = -8;
    synthRef.current = sampler;
    setSamplesLoaded(false);

    return () => {
      Tone.Transport.stop();
      Tone.Transport.cancel(0);
      sampler.dispose();
      reverb.dispose();
      synthRef.current = null;
      reverbRef.current = null;
    };
  }, []);

  // Animation frame to sync playhead
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      if (!scrubbingRef.current) {
        const t = Tone.Transport.seconds;
        if (duration > 0 && t >= duration - 0.001) {
          // Clamp to end and stop advancing when we reach the end
          setCurrentTime(duration);
          if (Tone.Transport.state === "started") {
            Tone.Transport.pause();
            setIsPlaying(false);
          }
        } else {
          setCurrentTime(Math.max(0, t));
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [duration]);

  const onChooseFile = () => inputRef.current?.click();

  const loadMidiFromData = useCallback(async (data: ArrayBuffer, name: string) => {
    try {
      const midi = new Midi(data);

      const collected: PianoNote[] = [];
      midi.tracks.forEach((t) => {
        t.notes.forEach((n) => {
          collected.push({
            midi: n.midi,
            time: n.time,
            duration: n.duration,
            velocity: n.velocity,
          });
        });
      });

      collected.sort((a, b) => a.time - b.time);
      const total = collected.reduce((acc, n) => Math.max(acc, n.time + n.duration), 0);

      setNotes(collected);
      setDuration(total);
      setFileName(name);
      Tone.Transport.position = 0;
      Tone.Transport.cancel(0);
      scheduledRef.current = [];
      setIsPlaying(false);

      toast.success("MIDI loaded! Ready to play.");
    } catch (err) {
      console.error(err);
      toast.error("Failed to load MIDI file.");
    }
  }, []);

  const processYouTubeUrl = useCallback(async () => {
    if (!youtubeUrl.trim()) {
      toast.error("Please enter a YouTube URL");
      return;
    }

    setIsProcessing(true);
    setProcessingStep("Initializing...");
    setProcessingProgress(0);

    try {
      const eventSource = new EventSource(
        `http://localhost:6389/process?url=${encodeURIComponent(youtubeUrl)}`
      );

      eventSource.onmessage = (event) => {
        const data = JSON.parse(event.data);
        
        if (data.type === 'progress') {
          setProcessingStep(data.step);
          setProcessingProgress(data.progress || 0);
        } else if (data.type === 'complete') {
          // Download the MIDI file
          fetch(`http://localhost:6389/download/${data.fileId}`)
            .then(response => response.arrayBuffer())
            .then(arrayBuffer => {
              loadMidiFromData(arrayBuffer, `${data.title || 'YouTube'}.mid`);
              setIsProcessing(false);
              setYoutubeUrl("");
              eventSource.close();
            })
            .catch(err => {
              console.error(err);
              toast.error("Failed to download processed MIDI");
              setIsProcessing(false);
              eventSource.close();
            });
        } else if (data.type === 'error') {
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

    } catch (err) {
      console.error(err);
      toast.error("Failed to start YouTube processing");
      setIsProcessing(false);
    }
  }, [youtubeUrl, loadMidiFromData]);

  const onFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const ab = await f.arrayBuffer();
    loadMidiFromData(ab, f.name);
  };

  const scheduleNotes = useCallback(() => {
    if (!synthRef.current) return;

    // Clear previous schedule
    Tone.Transport.cancel(0);
    scheduledRef.current = [];

    // Schedule each note
    notes.forEach((n) => {
      const id = Tone.Transport.schedule((time) => {
        const note = Tone.Frequency(n.midi, "midi").toNote();
        synthRef.current?.triggerAttackRelease(note, n.duration, time, n.velocity);
      }, n.time);
      scheduledRef.current.push(id);
    });
  }, [notes]);

  const onPlay = useCallback(async () => {
    if (!notes.length) {
      toast("Please upload a .mid file first");
      return;
    }
    await Tone.start();

    if (!samplesLoaded) {
      toast("Loading piano samples…");
      return;
    }

    // If transport is stopped, (re)schedule but keep current position (may have been set by seek)
    if (Tone.Transport.state === "stopped") {
      scheduleNotes();
    }

    Tone.Transport.start();
    setIsPlaying(true);
  }, [notes.length, scheduleNotes, samplesLoaded]);

  const onPause = useCallback(() => {
    Tone.Transport.pause();
    setIsPlaying(false);
  }, []);

  const onStop = useCallback(() => {
    Tone.Transport.stop();
    Tone.Transport.position = 0;
    setCurrentTime(0);
    setIsPlaying(false);
  }, []);

  const headerTitle = useMemo(() => fileName ?? "Upload a .mid file to begin", [fileName]);

  // Handlers for seek bar
  const handleScrub = useCallback((val: number) => {
    if (!scrubbingRef.current) {
      scrubbingRef.current = true;
      wasPlayingRef.current = isPlaying;
      if (isPlaying) {
        Tone.Transport.pause();
        setIsPlaying(false);
      }
    }
    setCurrentTime(val);
  }, [isPlaying]);

  const handleScrubEnd = useCallback((val: number) => {
    // Clamp to valid range
    const target = Math.min(Math.max(0, val), duration || 0);

    // Move transport to the new time
    try {
      // Prefer setting seconds to jump without starting
      // @ts-ignore Tone.Transport.seconds is a setter at runtime
      Tone.Transport.seconds = target;
    } catch {
      // Fallback
      // @ts-ignore position also accepts seconds
      Tone.Transport.position = target as any;
    }

    // If starting from stopped, ensure notes are scheduled
    if (Tone.Transport.state === "stopped") {
      scheduleNotes();
    }

    // Resume if user was playing
    if (wasPlayingRef.current) {
      Tone.Transport.start();
      setIsPlaying(true);
    }

    scrubbingRef.current = false;
    setCurrentTime(target);
  }, [scheduleNotes, duration]);

  return (
    <section className="container mx-auto max-w-6xl py-10">
      <header className="mb-6">
        <h1 className="text-3xl md:text-4xl font-semibold tracking-tight mb-2">Piano MIDI Player</h1>
        <p className="text-sm text-muted-foreground">{headerTitle}</p>
      </header>

      <div className="grid gap-6">
        <div className="surface-card p-4 md:p-6 animate-enter">
          <div className="flex flex-col gap-4">
            {/* File Upload Section */}
            <div className="flex flex-col md:flex-row md:items-center gap-3 md:gap-4 justify-between">
              <div className="flex items-center gap-3">
                <Button variant="hero" onClick={onChooseFile} className="hover-scale" disabled={isProcessing}>
                  <Upload />
                  Choose MIDI
                </Button>
                <input
                  ref={inputRef}
                  type="file"
                  accept=".mid,.midi"
                  onChange={onFileSelected}
                  className="hidden"
                />
                <div className="hidden md:block text-sm text-muted-foreground">
                  {fileName ? fileName : ".mid or .midi file"}
                </div>
              </div>

              <div className="flex items-center gap-2">
                {!isPlaying ? (
                  <Button onClick={onPlay} variant="secondary" className="hover-scale" aria-label="Play" disabled={isProcessing}>
                    <Play /> Play
                  </Button>
                ) : (
                  <Button onClick={onPause} variant="secondary" className="hover-scale" aria-label="Pause">
                    <Pause /> Pause
                  </Button>
                )}
                <Button onClick={onStop} variant="outline" className="hover-scale" aria-label="Stop" disabled={isProcessing}>
                  <Square /> Stop
                </Button>
              </div>
            </div>

            {/* YouTube Section */}
            <div className="flex flex-col gap-3 pt-4 border-t border-border">
              <div className="flex flex-col md:flex-row gap-3">
                <div className="flex-1">
                  <Input
                    placeholder="Enter YouTube URL..."
                    value={youtubeUrl}
                    onChange={(e) => setYoutubeUrl(e.target.value)}
                    disabled={isProcessing}
                    className="w-full"
                  />
                </div>
                <Button 
                  onClick={processYouTubeUrl} 
                  variant="secondary" 
                  className="hover-scale" 
                  disabled={isProcessing || !youtubeUrl.trim()}
                >
                  {isProcessing ? <Loader2 className="animate-spin" /> : <Youtube />}
                  {isProcessing ? "Processing..." : "Process YouTube"}
                </Button>
              </div>

              {/* Processing Progress */}
              {isProcessing && (
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{processingStep}</span>
                    <span className="text-muted-foreground">{Math.round(processingProgress)}%</span>
                  </div>
                  <Progress value={processingProgress} className="w-full" />
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="surface-card p-3 md:p-5">
          {/* Seekable progress bar */}
          <SeekBar
            current={currentTime}
            duration={duration}
            onScrub={handleScrub}
            onScrubEnd={handleScrubEnd}
            className="mb-3"
          />

          <FallingPiano notes={notes} currentTime={currentTime} totalDuration={duration} height={520} />
        </div>
      </div>
    </section>
  );
};

export default MidiPlayer;
