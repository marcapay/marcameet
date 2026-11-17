"use client";

import { useEffect, useState, memo } from "react";
import { recordingEngine } from "@/lib/audio/recordingEngine";

interface RecordingTimerDisplayProps {
  className?: string;
  fallbackText?: string;
}

function TimerComponent({ className = "", fallbackText = "00:00" }: RecordingTimerDisplayProps) {
  const [seconds, setSeconds] = useState<number>(() => {
    return recordingEngine.getElapsedSeconds() || 0;
  });

  useEffect(() => {
    let lastSec = recordingEngine.getElapsedSeconds();
    setSeconds(lastSec);

    const syncClockNow = () => {
      const currentSec = recordingEngine.getElapsedSeconds();
      if (currentSec !== lastSec) {
        lastSec = currentSec;
        setSeconds(currentSec);
      }
    };

    const unsubscribe = recordingEngine.subscribe({
      onTimerTick: (sec) => {
        if (sec !== lastSec) {
          lastSec = sec;
          setSeconds(sec);
        }
      },
      onStatusChange: () => {
        syncClockNow();
      },
      onChunkCaptured: () => {
        syncClockNow();
      },
    });

    const handleVisibilityOrFocus = () => {
      syncClockNow();
    };

    document.addEventListener("visibilitychange", handleVisibilityOrFocus);
    window.addEventListener("focus", handleVisibilityOrFocus);
    window.addEventListener("pageshow", handleVisibilityOrFocus);

    let rafId: number | null = null;
    const rafLoop = () => {
      if (document.visibilityState === "visible" && recordingEngine.isRecordingActive()) {
        syncClockNow();
      }
      rafId = requestAnimationFrame(rafLoop);
    };
    rafId = requestAnimationFrame(rafLoop);

    return () => {
      unsubscribe();
      document.removeEventListener("visibilitychange", handleVisibilityOrFocus);
      window.removeEventListener("focus", handleVisibilityOrFocus);
      window.removeEventListener("pageshow", handleVisibilityOrFocus);
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
    };
  }, []);

  const formatTimer = (totalSec: number) => {
    if (!totalSec || totalSec < 0) return fallbackText;
    const hrs = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    if (hrs > 0) {
      return `${hrs.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
    }
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  return <span className={className}>{formatTimer(seconds)}</span>;
}

export const RecordingTimerDisplay = memo(TimerComponent);
