import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Upload, Play, Pause, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import FallingPiano from "./FallingPiano";
import { PianoNote } from "./PianoRoll";
import { toast } from "sonner";

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

  const [fileName, setFileName] = useState<string | null>(null);
  const [notes, setNotes] = useState<PianoNote[]>([]);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [samplesLoaded, setSamplesLoaded] = useState(false);

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
      setCurrentTime(Tone.Transport.seconds);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const onChooseFile = () => inputRef.current?.click();

  const onFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const ab = await f.arrayBuffer();
      const midi = new Midi(ab);

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
      setFileName(f.name);
      Tone.Transport.position = 0;
      Tone.Transport.cancel(0);
      scheduledRef.current = [];
      setIsPlaying(false);

      toast.success("MIDI loaded! Ready to play.");
    } catch (err) {
      console.error(err);
      toast.error("Failed to load MIDI file.");
    }
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

    // If transport is at 0 or stopped, (re)schedule
    if (Tone.Transport.state === "stopped" || Math.abs(Tone.Transport.seconds) < 0.001) {
      Tone.Transport.position = 0;
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

  return (
    <section className="container mx-auto max-w-6xl py-10">
      <header className="mb-6">
        <h1 className="text-3xl md:text-4xl font-semibold tracking-tight mb-2">Piano MIDI Player</h1>
        <p className="text-sm text-muted-foreground">{headerTitle}</p>
      </header>

      <div className="grid gap-6">
        <div className="surface-card p-4 md:p-6 animate-enter">
          <div className="flex flex-col md:flex-row md:items-center gap-3 md:gap-4 justify-between">
            <div className="flex items-center gap-3">
              <Button variant="hero" onClick={onChooseFile} className="hover-scale">
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
                <Button onClick={onPlay} variant="secondary" className="hover-scale" aria-label="Play">
                  <Play /> Play
                </Button>
              ) : (
                <Button onClick={onPause} variant="secondary" className="hover-scale" aria-label="Pause">
                  <Pause /> Pause
                </Button>
              )}
              <Button onClick={onStop} variant="outline" className="hover-scale" aria-label="Stop">
                <Square /> Stop
              </Button>
            </div>
          </div>
        </div>

        <div className="surface-card p-2 md:p-4">
          <div className="flex items-center justify-between px-2 py-1 text-xs text-muted-foreground">
            <span>Time: {formatTime(currentTime)}</span>
            <span>Length: {formatTime(duration)}</span>
          </div>
          <FallingPiano notes={notes} currentTime={currentTime} totalDuration={duration} height={520} />
        </div>
      </div>
    </section>
  );
};

export default MidiPlayer;
