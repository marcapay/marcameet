"use client";

import { useEffect, useRef, useState } from "react";
import { Play, Pause, RotateCcw, RotateCw, Volume2, VolumeX, FastForward } from "lucide-react";

interface MediaPlayerProps {
  seekToTime?: number | null;
  onTimeUpdate?: (currentTime: number) => void;
}

export function MediaPlayer({ seekToTime, onTimeUpdate }: MediaPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(1420); // Fallback ~23m 40s
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [isMuted, setIsMuted] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const onTimeUpdateRef = useRef(onTimeUpdate);

  useEffect(() => {
    onTimeUpdateRef.current = onTimeUpdate;
  }, [onTimeUpdate]);

  // Efeito de Seek Externo (quando clica em timestamp da transcrição)
  useEffect(() => {
    if (seekToTime !== undefined && seekToTime !== null) {
      setCurrentTime(seekToTime);
      if (audioRef.current) {
        audioRef.current.currentTime = seekToTime;
        audioRef.current.play().catch(() => {});
        setIsPlaying(true);
      }
    }
  }, [seekToTime]);

  // Timer simulado com limpeza estrita de interval para evitar congelamentos de tela
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (isPlaying && (!audioRef.current || !audioRef.current.src)) {
      interval = setInterval(() => {
        setCurrentTime((prev) => {
          if (prev >= duration) {
            setIsPlaying(false);
            return 0;
          }
          const next = prev + 1 * playbackSpeed;
          if (onTimeUpdateRef.current) onTimeUpdateRef.current(next);
          return next;
        });
      }, 1000 / playbackSpeed);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isPlaying, duration, playbackSpeed]);

  const togglePlay = () => {
    if (audioRef.current && audioRef.current.src) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play();
      }
    }
    setIsPlaying(!isPlaying);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setCurrentTime(val);
    if (audioRef.current) {
      audioRef.current.currentTime = val;
    }
    if (onTimeUpdate) onTimeUpdate(val);
  };

  const skipSeconds = (sec: number) => {
    setCurrentTime((prev) => {
      const next = Math.max(0, Math.min(duration, prev + sec));
      if (audioRef.current) audioRef.current.currentTime = next;
      if (onTimeUpdate) onTimeUpdate(next);
      return next;
    });
  };

  const toggleSpeed = () => {
    const speeds = [1, 1.25, 1.5, 2];
    const nextIdx = (speeds.indexOf(playbackSpeed) + 1) % speeds.length;
    const newSpeed = speeds[nextIdx];
    setPlaybackSpeed(newSpeed);
    if (audioRef.current) {
      audioRef.current.playbackRate = newSpeed;
    }
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div className="p-4 rounded-2xl glass-card border border-indigo-500/30 space-y-3 shadow-xl">
      <audio ref={audioRef} className="hidden" />

      {/* Progress Bar */}
      <div className="space-y-1">
        <input
          type="range"
          min={0}
          max={duration}
          step={0.5}
          value={currentTime}
          onChange={handleSeek}
          className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
        />
        <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      {/* Player Controls */}
      <div className="flex items-center justify-between gap-2 pt-1">
        {/* Speed */}
        <button
          onClick={toggleSpeed}
          className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-[11px] font-bold text-indigo-300 hover:bg-slate-800 transition-colors"
        >
          {playbackSpeed}x
        </button>

        {/* Center Actions: Skip-10, Play/Pause, Skip+10 */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => skipSeconds(-10)}
            className="p-2 rounded-full hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
            title="Retroceder 10s"
          >
            <RotateCcw className="w-4 h-4" />
          </button>

          <button
            onClick={togglePlay}
            className="w-11 h-11 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center shadow-lg shadow-indigo-600/30 active:scale-95 transition-all"
          >
            {isPlaying ? <Pause className="w-5 h-5 fill-white" /> : <Play className="w-5 h-5 fill-white ml-0.5" />}
          </button>

          <button
            onClick={() => skipSeconds(10)}
            className="p-2 rounded-full hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
            title="Avançar 10s"
          >
            <RotateCw className="w-4 h-4" />
          </button>
        </div>

        {/* Mute */}
        <button
          onClick={() => setIsMuted(!isMuted)}
          className="p-2 rounded-lg text-slate-400 hover:text-white transition-colors"
        >
          {isMuted ? <VolumeX className="w-4 h-4 text-rose-400" /> : <Volume2 className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}
