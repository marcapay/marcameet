"use client";

import { useEffect, useRef, useState } from "react";
import { Play, Pause, RotateCcw, RotateCw, Volume2, VolumeX, Download, Headphones } from "lucide-react";
import { getMeetingAudioBlob, saveMeetingAudioBlob } from "@/lib/recording/chunkStore";
import { fetchAudioDataUrlFromSupabase } from "@/lib/supabase/client";

interface MediaPlayerProps {
  meetingId?: string;
  fallbackDuration?: number;
  transcriptText?: string;
  seekToTime?: number | null;
  onTimeUpdate?: (currentTime: number) => void;
}

export function MediaPlayer({
  meetingId,
  fallbackDuration,
  transcriptText,
  seekToTime,
  onTimeUpdate,
}: MediaPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState<number>(fallbackDuration && fallbackDuration > 0 ? fallbackDuration : 30);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const onTimeUpdateRef = useRef(onTimeUpdate);

  useEffect(() => {
    onTimeUpdateRef.current = onTimeUpdate;
  }, [onTimeUpdate]);

  useEffect(() => {
    if (fallbackDuration && fallbackDuration > 0) {
      setDuration(fallbackDuration);
    }
  }, [fallbackDuration]);

  // Carregar áudio real gravado da reunião (IndexedDB local -> fallback Supabase Cloud)
  useEffect(() => {
    let active = true;
    let createdObjectUrl: string | null = null;

    setIsPlaying(false);
    setCurrentTime(0);
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }

    if (!meetingId) {
      setAudioUrl(null);
      return;
    }

    setIsLoadingAudio(true);

    (async () => {
      try {
        // 1. Tentar carregar do IndexedDB local
        const localBlob = await getMeetingAudioBlob(meetingId);
        if (active && localBlob && localBlob.size > 0) {
          createdObjectUrl = URL.createObjectURL(localBlob);
          setAudioUrl(createdObjectUrl);
          setIsLoadingAudio(false);
          return;
        }

        // 2. Tentar carregar do Supabase caso tenha sido gravado em outro aparelho
        const cloudDataUrl = await fetchAudioDataUrlFromSupabase(meetingId);
        if (active && cloudDataUrl) {
          setAudioUrl(cloudDataUrl);
          // Salvar cópia no IndexedDB local para acesso instantâneo
          try {
            const res = await fetch(cloudDataUrl);
            const blob = await res.blob();
            await saveMeetingAudioBlob(meetingId, blob, blob.type);
          } catch {}
          setIsLoadingAudio(false);
          return;
        }

        if (active) {
          setAudioUrl(null);
        }
      } catch {
        if (active) setAudioUrl(null);
      } finally {
        if (active) setIsLoadingAudio(false);
      }
    })();

    return () => {
      active = false;
      if (createdObjectUrl) {
        URL.revokeObjectURL(createdObjectUrl);
      }
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, [meetingId]);

  // Efeito de Seek Externo (quando clica em timestamp da transcrição)
  useEffect(() => {
    if (seekToTime !== undefined && seekToTime !== null) {
      setCurrentTime(seekToTime);
      if (audioRef.current && audioUrl) {
        audioRef.current.currentTime = seekToTime;
        audioRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
      } else {
        setIsPlaying(true);
      }
    }
  }, [seekToTime, audioUrl]);

  // Sincronizar eventos nativos do elemento <audio> quando há áudio gravado real
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !audioUrl) return;

    const handleLoadedMetadata = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        setDuration(Math.ceil(audio.duration));
      } else if (fallbackDuration && fallbackDuration > 0) {
        setDuration(fallbackDuration);
      }
    };

    const handleTimeUpdate = () => {
      const t = audio.currentTime || 0;
      setCurrentTime(t);
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        setDuration(Math.ceil(audio.duration));
      } else if (t > duration) {
        setDuration(Math.ceil(t));
      }
      if (onTimeUpdateRef.current) onTimeUpdateRef.current(t);
    };

    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);

    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("durationchange", handleLoadedMetadata);
    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("play", handlePlay);
    audio.addEventListener("pause", handlePause);

    return () => {
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("durationchange", handleLoadedMetadata);
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("pause", handlePause);
    };
  }, [audioUrl, fallbackDuration, duration]);

  // Fallback para reuniões antigas (sem blob gravado) usando leitura de voz em português + cronômetro real
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (isPlaying && !audioUrl) {
      interval = setInterval(() => {
        setCurrentTime((prev) => {
          if (prev >= duration) {
            setIsPlaying(false);
            if (typeof window !== "undefined" && "speechSynthesis" in window) {
              window.speechSynthesis.cancel();
            }
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
  }, [isPlaying, audioUrl, duration, playbackSpeed]);

  const togglePlay = () => {
    if (audioRef.current && audioUrl) {
      if (isPlaying) {
        audioRef.current.pause();
        setIsPlaying(false);
      } else {
        audioRef.current.muted = isMuted;
        audioRef.current.playbackRate = playbackSpeed;
        audioRef.current
          .play()
          .then(() => setIsPlaying(true))
          .catch((err) => {
            console.warn("Erro ao reproduzir áudio:", err);
          });
      }
      return;
    }

    // Fallback de voz sintetizada caso seja uma reunião antiga sem arquivo de áudio salvo
    if (typeof window !== "undefined" && "speechSynthesis" in window && transcriptText) {
      if (isPlaying) {
        window.speechSynthesis.cancel();
        setIsPlaying(false);
      } else {
        window.speechSynthesis.cancel();
        if (!isMuted) {
          const cleanSpeech = transcriptText.replace(/\[\d{2}:\d{2}\]/g, "").trim();
          const utterance = new SpeechSynthesisUtterance(cleanSpeech);
          utterance.lang = "pt-BR";
          utterance.rate = playbackSpeed;
          utterance.onend = () => {
            setIsPlaying(false);
            setCurrentTime(0);
          };
          window.speechSynthesis.speak(utterance);
        }
        setIsPlaying(true);
      }
    } else {
      setIsPlaying(!isPlaying);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setCurrentTime(val);
    if (audioRef.current && audioUrl) {
      audioRef.current.currentTime = val;
    }
    if (onTimeUpdate) onTimeUpdate(val);
  };

  const skipSeconds = (sec: number) => {
    const next = Math.max(0, Math.min(duration, currentTime + sec));
    setCurrentTime(next);
    if (audioRef.current && audioUrl) {
      audioRef.current.currentTime = next;
    }
    if (onTimeUpdate) onTimeUpdate(next);
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

  const toggleMute = () => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    if (audioRef.current) {
      audioRef.current.muted = nextMuted;
    }
    if (nextMuted && typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  };

  const formatTime = (seconds: number) => {
    const safeSec = Number.isFinite(seconds) && seconds >= 0 ? seconds : 0;
    const m = Math.floor(safeSec / 60);
    const s = Math.floor(safeSec % 60);
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div className="p-4 rounded-2xl glass-card border border-indigo-500/30 space-y-3 shadow-xl">
      <audio ref={audioRef} src={audioUrl || undefined} preload="metadata" className="hidden" />

      {/* Topo do Player: Indicador de Áudio da Reunião */}
      <div className="flex items-center justify-between text-[11px] text-slate-400">
        <span className="flex items-center gap-1.5 font-semibold text-indigo-300">
          <Headphones className="w-3.5 h-3.5 text-indigo-400" />
          <span>
            {isLoadingAudio
              ? "Carregando áudio da reunião..."
              : audioUrl
              ? "Áudio original da reunião gravado"
              : "Leitura em voz da transcrição"}
          </span>
        </span>

        {audioUrl && (
          <a
            href={audioUrl}
            download={`reuniao-${meetingId || "audio"}.webm`}
            className="flex items-center gap-1 text-[11px] font-bold text-emerald-400 hover:underline"
            title="Baixar arquivo de áudio da reunião"
          >
            <Download className="w-3 h-3" />
            <span>Baixar áudio</span>
          </a>
        )}
      </div>

      {/* Progress Bar */}
      <div className="space-y-1">
        <input
          type="range"
          min={0}
          max={Math.max(1, duration)}
          step={0.5}
          value={Math.min(currentTime, Math.max(1, duration))}
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
          type="button"
          onClick={toggleSpeed}
          className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-[11px] font-bold text-indigo-300 hover:bg-slate-800 transition-colors"
        >
          {playbackSpeed}x
        </button>

        {/* Center Actions: Skip-10, Play/Pause, Skip+10 */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => skipSeconds(-10)}
            className="p-2 rounded-full hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
            title="Retroceder 10s"
          >
            <RotateCcw className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={togglePlay}
            className="w-11 h-11 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center shadow-lg shadow-indigo-600/30 active:scale-95 transition-all"
          >
            {isPlaying ? <Pause className="w-5 h-5 fill-white" /> : <Play className="w-5 h-5 fill-white ml-0.5" />}
          </button>

          <button
            type="button"
            onClick={() => skipSeconds(10)}
            className="p-2 rounded-full hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
            title="Avançar 10s"
          >
            <RotateCw className="w-4 h-4" />
          </button>
        </div>

        {/* Mute */}
        <button
          type="button"
          onClick={toggleMute}
          className="p-2 rounded-lg text-slate-400 hover:text-white transition-colors"
        >
          {isMuted ? <VolumeX className="w-4 h-4 text-rose-400" /> : <Volume2 className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}
