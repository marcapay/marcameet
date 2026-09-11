"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Radio, Mic, AlertTriangle, ArrowRight, Square, Play } from "lucide-react";
import { recordingEngine } from "@/lib/audio/recordingEngine";
import { ActiveMeetingSessionState } from "@/types/database";

export function ActiveMeetingBanner() {
  const router = useRouter();
  const pathname = usePathname();

  const [activeSession, setActiveSession] = useState<ActiveMeetingSessionState | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [isFinishing, setIsFinishing] = useState(false);

  useEffect(() => {
    // Subscrever a eventos da engine de gravação
    const unsubscribe = recordingEngine.subscribe({
      onStatusChange: (status, session) => {
        if (session && status !== "finished" && status !== "idle") {
          setActiveSession({ ...session });
        } else {
          setActiveSession(null);
        }
      },
      onTimerTick: (sec) => {
        setSeconds(sec);
      },
    });

    // Tentar restaurar reunião ativa ao carregar
    recordingEngine.restoreActiveSessionOnLoad().then((session) => {
      if (session && session.status !== "finished") {
        setActiveSession(session);
        setSeconds(recordingEngine.getElapsedSeconds());
      }
    });

    return () => {
      unsubscribe();
    };
  }, []);

  if (!activeSession || activeSession.status === "finished" || activeSession.status === "idle") {
    return null;
  }

  // Formatação de Tempo mm:ss / hh:mm:ss
  const formatTimer = (totalSec: number) => {
    const hrs = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    if (hrs > 0) {
      return `${hrs.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
    }
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const handleRetakeMeeting = () => {
    if (activeSession.source_type === "online_meeting") {
      router.push("/online-meet");
    } else {
      router.push("/record");
    }
  };

  const confirmFinishMeeting = async () => {
    try {
      setIsFinishing(true);
      await recordingEngine.finishMeeting();
      setShowConfirmModal(false);
      setActiveSession(null);
      router.push("/meetings");
    } catch (err) {
      console.error("Erro ao encerrar reunião:", err);
    } finally {
      setIsFinishing(false);
    }
  };

  // Se o usuário já estiver na própria página de gravação ativa, mostrar versão simplificada da barra no topo
  const isOnRecordingPage =
    (activeSession.source_type === "online_meeting" && pathname === "/online-meet") ||
    (activeSession.source_type !== "online_meeting" && pathname === "/record");

  return (
    <>
      {/* Banner Principal Fixo quando navegando fora da página de gravação */}
      {!isOnRecordingPage && (
        <div className="bg-gradient-to-r from-rose-900/90 via-indigo-900/90 to-purple-900/90 border-b border-rose-500/30 text-white px-4 py-2.5 shadow-xl backdrop-blur-md sticky top-16 z-30 flex flex-col sm:flex-row items-center justify-between gap-3 animate-fadeIn">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-rose-500/20 border border-rose-500/40 text-rose-300 text-xs font-bold animate-pulse">
              <span className="w-2 h-2 rounded-full bg-rose-500"></span>
              <span>🔴 GRAVANDO</span>
            </div>
            <div>
              <p className="text-xs font-bold text-white tracking-wide truncate max-w-[200px] sm:max-w-md">
                {activeSession.title}
              </p>
              <p className="text-[10px] text-slate-300">
                Duração real: <span className="font-mono font-bold text-amber-300">{formatTimer(seconds)}</span> • O áudio continua sendo salvo com segurança em segundo plano.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={handleRetakeMeeting}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md transition-all active:scale-95"
            >
              <span>Retomar reunião</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setShowConfirmModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-600/80 hover:bg-rose-600 text-white text-xs font-semibold shadow-md transition-all active:scale-95"
            >
              <Square className="w-3 h-3 fill-current" />
              <span>Encerrar reunião</span>
            </button>
          </div>
        </div>
      )}

      {/* Modal Obrigatório de Confirmação para Encerrar Reunião */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-5">
            <div className="flex items-center gap-3 text-rose-400">
              <div className="w-10 h-10 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-white">Tem certeza de que deseja encerrar a gravação?</h3>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Ao encerrar a reunião, a captura de áudio será finalizada definitivamente e os blocos gravados serão processados para gerar a transcrição e o resumo por IA.
            </p>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                disabled={isFinishing}
                onClick={() => setShowConfirmModal(false)}
                className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs transition-all active:scale-95"
              >
                Continuar gravando
              </button>
              <button
                disabled={isFinishing}
                onClick={confirmFinishMeeting}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs shadow-lg shadow-rose-600/30 transition-all active:scale-95"
              >
                {isFinishing ? (
                  <span>Encerrando...</span>
                ) : (
                  <>
                    <Square className="w-3.5 h-3.5 fill-current" />
                    <span>Encerrar reunião</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
