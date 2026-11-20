"use client";

import { useEffect, useState } from "react";
import { Smartphone, AlertCircle, ShieldCheck, Cloud, CheckCircle2 } from "lucide-react";
import {
  getWakeLockState,
  subscribeWakeLockState,
  WakeLockStateInfo,
} from "@/lib/audio/recordingKeepAlive";
import {
  getUploaderState,
  subscribeUploaderState,
  UploaderSyncState,
} from "@/lib/recording/chunkUploader";

import { RecordingGuidance } from "./RecordingGuidance";

interface WakeLockStatusBadgeProps {
  isRecording: boolean;
  showOrientation?: boolean;
  savedChunksCount?: number;
}

export function WakeLockStatusBadge({
  isRecording,
  showOrientation = true,
  savedChunksCount,
}: WakeLockStatusBadgeProps) {
  const [wakeInfo, setWakeInfo] = useState<WakeLockStateInfo>(getWakeLockState());
  const [syncInfo, setSyncInfo] = useState<UploaderSyncState>(getUploaderState());

  useEffect(() => {
    const unsubWake = subscribeWakeLockState((info) => {
      setWakeInfo(info);
    });
    const unsubSync = subscribeUploaderState((state) => {
      setSyncInfo(state);
    });
    return () => {
      unsubWake();
      unsubSync();
    };
  }, []);

  if (!isRecording) return null;

  const totalSaved = Math.max(savedChunksCount || 0, syncInfo.totalCount || 0);

  return (
    <div className="space-y-2.5 max-w-lg mx-auto text-left">
      {/* Indicadores de Wake Lock, IndexedDB e Sincronização de Segmentos */}
      <div className="flex flex-wrap items-center justify-center gap-2">
        {wakeInfo.status === "active" && (
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[11px] font-semibold">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
            <Smartphone className="w-3.5 h-3.5 text-emerald-400" />
            <span>Tela ativa durante a gravação</span>
          </div>
        )}

        {(wakeInfo.status === "unsupported" || wakeInfo.status === "denied") && (
          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-200 text-[11px] font-medium text-center">
            <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span>
              {wakeInfo.message ||
                "O navegador não conseguiu manter a tela ligada automaticamente. Mantenha a tela ligada durante a gravação."}
            </span>
          </div>
        )}

        {wakeInfo.status === "released" && (
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 text-[11px] font-semibold">
            <Smartphone className="w-3.5 h-3.5 text-indigo-400" />
            <span>Proteção contra apagar a tela inativa</span>
          </div>
        )}

        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 text-[11px] font-semibold">
          <ShieldCheck className="w-3.5 h-3.5 text-indigo-400" />
          <span>
            IndexedDB ativo
            {totalSaved > 0 ? ` (${totalSaved} segmentos salvos)` : ""}
          </span>
        </div>

        {syncInfo.isSyncing || syncInfo.pendingCount > 0 ? (
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-sky-500/15 border border-sky-500/30 text-sky-300 text-[11px] font-semibold">
            <Cloud className="w-3.5 h-3.5 text-sky-400 animate-pulse" />
            <span>
              ☁️ Sincronizando áudio ({syncInfo.syncedCount}/{totalSaved})
            </span>
          </div>
        ) : totalSaved > 0 ? (
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[11px] font-semibold">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            <span>✅ Gravação salva ({syncInfo.syncedCount} sincronizados)</span>
          </div>
        ) : null}
      </div>

      {showOrientation && <RecordingGuidance />}
    </div>
  );
}
