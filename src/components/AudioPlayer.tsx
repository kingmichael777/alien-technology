import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { Pause, Play, RotateCcw, RotateCw } from "lucide-react";
import type { RecordingRow } from "@/lib/db";
import { length } from "@/lib/format";
import { audioSource } from "@/lib/library";
import { Spinner, SW } from "./ui";

/** Lets the transcript jump the player to a moment. */
interface PlayerStore {
  time: number;
  playing: boolean;
  seek: (seconds: number) => void;
}

let element: HTMLAudioElement | null = null;
let pendingSeek: number | null = null;
let playWhenReady = false;
let requestLoad: (() => void) | null = null;

export const usePlayer = create<PlayerStore>(() => ({
  time: 0,
  playing: false,
  seek: (seconds: number) => {
    const el = element;
    if (el && el.getAttribute("src")) {
      el.currentTime = seconds;
      void el.play().catch(() => undefined);
      return;
    }
    pendingSeek = seconds;
    playWhenReady = true;
    requestLoad?.();
  },
}));

const SPEEDS = [1, 1.5, 2];

export function AudioPlayer({ row, durationMs }: { row: RecordingRow; durationMs: number }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const objectUrl = useRef<string | null>(null);
  const loadingRef = useRef(false);
  const retried = useRef(false);
  const total = Math.max(1, durationMs / 1000);

  const load = async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setNote(null);
    try {
      const got = await audioSource(row);
      if (!got) {
        setNote(navigator.onLine ? "The audio isn't on your server yet." : "Connect to the internet to play this recording.");
        playWhenReady = false;
        return;
      }
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      objectUrl.current = got.revoke ? got.url : null;
      setSrc(got.url);
    } catch (e) {
      setNote(e instanceof Error ? e.message : "The audio couldn't be loaded.");
      playWhenReady = false;
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  };

  // Load as soon as the screen opens, so a tap on Play can start sound at
  // once (iPhones only allow sound that starts inside the tap). Audio split
  // across several server parts is large, so that waits for a tap.
  useEffect(() => {
    if (row.hasAudio || (row.server?.parts ?? 1) <= 1) void load();
    return () => {
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      objectUrl.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.id, row.hasAudio]);

  useEffect(() => {
    element = ref.current;
    requestLoad = () => void load();
    return () => {
      element = null;
      requestLoad = null;
    };
  });

  useEffect(
    () => () => {
      pendingSeek = null;
      playWhenReady = false;
      usePlayer.setState({ time: 0, playing: false });
    },
    [],
  );

  useEffect(() => {
    if (ref.current) ref.current.playbackRate = speed;
  }, [speed, src]);

  const toggle = () => {
    const el = ref.current;
    if (!el) return;
    if (!src) {
      playWhenReady = true;
      void load();
      return;
    }
    if (el.paused) void el.play().catch(() => setNote("The audio couldn't play. Tap Play again."));
    else el.pause();
  };

  const jump = (delta: number) => {
    const el = ref.current;
    if (!el || !src) return;
    el.currentTime = Math.min(Math.max(0, el.currentTime + delta), total);
  };

  return (
    <div className="card-at px-4 py-3.5">
      <audio
        ref={ref}
        src={src ?? undefined}
        preload="metadata"
        onTimeUpdate={(e) => {
          const t = e.currentTarget.currentTime;
          setTime(t);
          usePlayer.setState({ time: t });
        }}
        onPlay={() => {
          setPlaying(true);
          usePlayer.setState({ playing: true });
        }}
        onPause={() => {
          setPlaying(false);
          usePlayer.setState({ playing: false });
        }}
        onLoadedMetadata={(e) => {
          const el = e.currentTarget;
          el.playbackRate = speed;
          if (pendingSeek !== null) {
            el.currentTime = pendingSeek;
            pendingSeek = null;
          }
          if (playWhenReady) {
            playWhenReady = false;
            void el.play().catch(() => setNote("Tap Play to listen."));
          }
        }}
        onError={() => {
          if (!src) return;
          // A server link lasts an hour; get a fresh one once.
          if (!objectUrl.current && !retried.current) {
            retried.current = true;
            setSrc(null);
            void load();
            return;
          }
          setNote("The audio couldn't play on this phone.");
        }}
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label={playing ? "Pause" : "Play"}
          onClick={toggle}
          className="grid size-12 shrink-0 place-items-center rounded-full bg-amber text-[var(--on-amber)] active:bg-amber-bright"
        >
          {loading && !src ? (
            <Spinner className="size-5 border-black/20 border-t-black" />
          ) : playing ? (
            <Pause size={22} strokeWidth={2} fill="currentColor" />
          ) : (
            <Play size={22} strokeWidth={2} fill="currentColor" className="translate-x-[1px]" />
          )}
        </button>
        <button type="button" aria-label="Back 15 seconds" onClick={() => jump(-15)} className="tap grid place-items-center text-ink-muted active:text-amber">
          <RotateCcw size={20} strokeWidth={SW} />
        </button>
        <button type="button" aria-label="Forward 15 seconds" onClick={() => jump(15)} className="tap grid place-items-center text-ink-muted active:text-amber">
          <RotateCw size={20} strokeWidth={SW} />
        </button>
        <div className="min-w-0 flex-1 text-right font-mono text-[13px] tabular-nums text-ink-muted">
          {length(time * 1000)} / {length(durationMs)}
        </div>
        <button
          type="button"
          aria-label={`Playback speed ${speed} times`}
          onClick={() => setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length])}
          className="tap ml-1 grid place-items-center rounded-full font-mono text-[13px] text-amber"
        >
          {speed}x
        </button>
      </div>
      <input
        type="range"
        aria-label="Position"
        min={0}
        max={total}
        step={0.1}
        value={Math.min(time, total)}
        onChange={(e) => {
          const t = Number(e.target.value);
          setTime(t);
          const el = ref.current;
          if (el && src) el.currentTime = t;
          else pendingSeek = t;
        }}
        className="at-range mt-3 w-full"
        style={{ ["--fill" as string]: `${(Math.min(time, total) / total) * 100}%` }}
      />
      {note && <p className="mt-2 text-[13px] text-ink-muted">{note}</p>}
    </div>
  );
}
