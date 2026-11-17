"use client";

import { useEffect, useState } from "react";
import { Smartphone, AlertCircle, ShieldCheck, Info } from "lucide-react";
import {
  getWakeLockState,
  subscribeWakeLockState,
  WakeLockStateInfo,
} from "@/lib/audio/recordingKeepAlive";

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

  useEffect(() => {
    const unsub = subscribeWakeLockState((info) => {
      setWakeInfo(info);
    });
    return () => unsub();
  }, []);

  if (!isRecording) return null;

  return (
    <div className="space-y-2.5 max-w-lg mx-auto text-left">
      {/* Indicador discreto de status do Screen Wake Lock (Requisitos 5 e 6) */}
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
                "Bloqueio automático de tela indisponível neste navegador. A gravação continua ativa — mantenha a tela ligada."}
            </span>
          </div>
        )}

        {wakeInfo.status === "released" && (
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[11px] font-semibold">
            <Smartphone className="w-3.5 h-3.5 text-amber-400" />
            <span>Reativando tela ativa ao manter a página visível...</span>
          </div>
        )}

        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 text-[11px] font-semibold">
          <ShieldCheck className="w-3.5 h-3.5 text-indigo-400" />
          <span>
            Salvamento periódico ativo
            {typeof savedChunksCount === "number" && savedChunksCount > 0
              ? ` (${savedChunksCount} trechos salvos)`
              : ""}
          </span>
        </div>
      </div>

      {/* Orientação obrigatória para manter a página aberta e visível */}
      {showOrientation && (
        <div className="p-3 rounded-2xl bg-slate-900/90 border border-slate-800 text-slate-300 text-[11px] flex items-start gap-2.5 leading-relaxed">
          <Info className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
          <span>
            <strong className="text-slate-100">Orientação importante:</strong> Mantenha esta página aberta e visível durante toda a gravação. Bloquear a tela do celular ou enviar o navegador para segundo plano pode pausar ou interromper a captura de áudio pelo sistema operacional.
          </span>
        </div>
      )}
    </div>
  );
}
