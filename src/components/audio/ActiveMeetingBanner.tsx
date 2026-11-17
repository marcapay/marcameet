"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { AlertTriangle, ArrowRight, Square, Smartphone } from "lucide-react";
import { RecordingTimerDisplay } from "@/components/audio/RecordingTimerDisplay";
import { recordingEngine } from "@/lib/audio/recordingEngine";
import { getWakeLockState, subscribeWakeLockState, WakeLockStateInfo } from "@/lib/audio/recordingKeepAlive";
import { saveLocalMeeting } from "@/lib/storage/mockStorage";
import { processAIAnalysis } from "@/lib/ai";
import { getCurrentAccount } from "@/lib/auth/accountSystem";
import { ActiveMeetingSessionState, CompleteMeetingDetails } from "@/types/database";

export function ActiveMeetingBanner() {
  const router = useRouter();
  const pathname = usePathname();

  const [activeSession, setActiveSession] = useState<ActiveMeetingSessionState | null>(null);
  const [wakeInfo, setWakeInfo] = useState<WakeLockStateInfo>(getWakeLockState());
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [isFinishing, setIsFinishing] = useState(false);

  useEffect(() => {
    const unsubscribe = recordingEngine.subscribe({
      onStatusChange: (status, session) => {
        if (session && status !== "finished" && status !== "idle") {
          setActiveSession(session);
        } else {
          setActiveSession(null);
        }
      },
    });

    const unsubWake = subscribeWakeLockState((info) => {
      setWakeInfo(info);
    });

    recordingEngine.restoreActiveSessionOnLoad().then((session) => {
      if (session && session.status !== "finished") {
        setActiveSession(session);
      }
    });

    return () => {
      unsubscribe();
      unsubWake();
    };
  }, []);

  if (!activeSession || activeSession.status === "finished" || activeSession.status === "idle") {
    return null;
  }

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
      const sessionSnapshot = activeSession;
      const result = await recordingEngine.finishMeeting();

      const newMeetingId = result.meetingId;
      const duration = result.durationSeconds;
      const rawTextDraft = result.transcriptDraft || "Reunião recuperada e salva com sucesso.";
      const meetingTitle = sessionSnapshot.title || "Reunião Recuperada";
      const activeAccount = getCurrentAccount();

      const segmentsDraft =
        result.segmentsDraft && result.segmentsDraft.length > 0
          ? result.segmentsDraft
          : [{ start_time: 0, end_time: duration || 5, speaker: "Participante 1", text: rawTextDraft }];

      let aiData: any = null;
      try {
        aiData = await processAIAnalysis(rawTextDraft, segmentsDraft);
      } catch {}

      const formattedTasks = (aiData?.tasks || []).map((t: any, idx: number) => ({
        id: `task-${Date.now()}-${idx}`,
        meeting_id: newMeetingId,
        user_id: activeAccount?.id || "u-001",
        title: t.title,
        description: t.description || "",
        assignee: t.assignee || "Responsável não definido",
        original_due_date_text: t.due_date_text || "Prazo não definido",
        priority: t.priority || "Média",
        status: "Pendente" as const,
        timestamp_start: t.timestamp_start,
        original_snippet: t.original_snippet,
        created_at: new Date().toISOString(),
        meeting_title: meetingTitle,
      }));

      const finalDetails: CompleteMeetingDetails = {
        meeting: {
          id: newMeetingId,
          user_id: activeAccount?.id || "u-001",
          user_email: activeAccount?.email,
          title: meetingTitle,
          description: "Gravação salva e recuperada com proteção periódica de áudio.",
          meeting_date: sessionSnapshot.started_at || new Date().toISOString(),
          duration_seconds: duration,
          source_type: sessionSnapshot.source_type || "recording",
          status: "CONCLUIDA",
          error_message: null,
          tags: ["Recuperada", "Salva na Conta"],
          created_at: sessionSnapshot.started_at || new Date().toISOString(),
          updated_at: new Date().toISOString(),
          tasks_count: formattedTasks.length,
          decisions_count: (aiData?.decisions || []).length,
          highlights_count: (aiData?.highlights || []).length,
        },
        transcript: {
          id: `t-${newMeetingId}`,
          meeting_id: newMeetingId,
          raw_text: rawTextDraft,
          speaker_map: result.speakerMap || { "Participante 1": "Participante 1" },
          segments: segmentsDraft.map((s: any, i: number) => ({
            id: `seg-${newMeetingId}-${i}`,
            transcript_id: `t-${newMeetingId}`,
            meeting_id: newMeetingId,
            start_time: s.start_time || 0,
            end_time: s.end_time || duration || 5,
            speaker: s.speaker || "Participante 1",
            text: s.text || rawTextDraft,
          })),
        },
        summary: aiData
          ? {
              id: `sum-${newMeetingId}`,
              meeting_id: newMeetingId,
              objective: aiData.objective,
              key_topics: aiData.key_topics || [],
              conclusions: aiData.conclusions,
              final_status: aiData.final_status || "Concluída",
            }
          : undefined,
        highlights: (aiData?.highlights || []).map((h: any, i: number) => ({
          id: `h-${newMeetingId}-${i}`,
          meeting_id: newMeetingId,
          description: h.description,
          timestamp_start: h.timestamp_start,
          original_snippet: h.original_snippet,
        })),
        decisions: (aiData?.decisions || []).map((d: any, i: number) => ({
          id: `d-${newMeetingId}-${i}`,
          meeting_id: newMeetingId,
          decision_text: d.decision_text,
          timestamp_start: d.timestamp_start,
          original_snippet: d.original_snippet,
        })),
        tasks: formattedTasks,
        pending_items: (aiData?.pending_items || []).map((p: any, i: number) => ({
          id: `p-${newMeetingId}-${i}`,
          meeting_id: newMeetingId,
          item_text: p.item_text,
          timestamp_start: p.timestamp_start,
        })),
        risks: (aiData?.risks || []).map((r: any, i: number) => ({
          id: `r-${newMeetingId}-${i}`,
          meeting_id: newMeetingId,
          risk_type: r.risk_type,
          description: r.description,
          is_ai_generated: r.is_ai_generated,
          timestamp_start: r.timestamp_start,
        })),
        opportunities: (aiData?.opportunities || []).map((op: any, i: number) => ({
          id: `op-${newMeetingId}-${i}`,
          meeting_id: newMeetingId,
          category: op.category,
          description: op.description,
          timestamp_start: op.timestamp_start,
        })),
        values: (aiData?.values || []).map((v: any, i: number) => ({
          id: `v-${newMeetingId}-${i}`,
          meeting_id: newMeetingId,
          amount_formatted: v.amount_formatted,
          numeric_value: v.numeric_value,
          context: v.context,
          timestamp_start: v.timestamp_start,
          original_snippet: v.original_snippet,
        })),
        dates: (aiData?.dates || []).map((dt: any, i: number) => ({
          id: `dt-${newMeetingId}-${i}`,
          meeting_id: newMeetingId,
          original_text: dt.original_text,
          context: dt.context,
          timestamp_start: dt.timestamp_start,
        })),
        quotes: (aiData?.quotes || []).map((q: any, i: number) => ({
          id: `q-${newMeetingId}-${i}`,
          meeting_id: newMeetingId,
          speaker: q.speaker,
          phrase: q.phrase,
          timestamp_start: q.timestamp_start,
        })),
        next_steps_agreed: aiData?.next_steps_agreed || [],
        next_steps_ai_suggestions: aiData?.next_steps_ai_suggestions || [],
      };

      saveLocalMeeting(finalDetails);
      setShowConfirmModal(false);
      setActiveSession(null);
      router.push(`/tasks?meetingId=${newMeetingId}`);
    } catch (err) {
      console.error("Erro ao encerrar reunião:", err);
    } finally {
      setIsFinishing(false);
    }
  };

  const isOnRecordingPage =
    (activeSession.source_type === "online_meeting" && pathname === "/online-meet") ||
    (activeSession.source_type !== "online_meeting" && pathname === "/record");

  const isInterrupted = activeSession.status === "interrupted" || !recordingEngine.hasLiveRecorder();

  return (
    <>
      {!isOnRecordingPage && (
        <div className="bg-gradient-to-r from-rose-900/90 via-indigo-900/90 to-purple-900/90 border-b border-rose-500/30 text-white px-4 py-2.5 shadow-xl backdrop-blur-md sticky top-16 z-30 flex flex-col sm:flex-row items-center justify-between gap-3 animate-fadeIn">
          <div className="flex flex-wrap items-center gap-3">
            {isInterrupted ? (
              <div className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 text-xs font-bold">
                <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                <span>GRAVAÇÃO INTERROMPIDA (PRONTA PARA RECUPERAR)</span>
              </div>
            ) : activeSession.recorder_status === "paused" ? (
              <div className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 text-xs font-bold">
                <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                <span>
                  {activeSession.auto_paused_reason === "screen_off"
                    ? "PAUSADO (TELA APAGADA)"
                    : activeSession.auto_paused_reason === "mic_mute"
                    ? "PAUSADO (SEM ÁUDIO)"
                    : "PAUSADO"}
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-rose-500/20 border border-rose-500/40 text-rose-300 text-xs font-bold animate-pulse">
                <span className="w-2 h-2 rounded-full bg-rose-500"></span>
                <span>🔴 GRAVANDO</span>
              </div>
            )}

            {wakeInfo.status === "active" && !isInterrupted && (
              <span className="hidden md:inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-[11px] font-semibold">
                <Smartphone className="w-3 h-3 text-emerald-400" />
                <span>Tela ativa durante a gravação</span>
              </span>
            )}

            <div>
              <p className="text-xs font-bold text-white tracking-wide truncate max-w-[200px] sm:max-w-md">
                {activeSession.title}
              </p>
              <p className="text-[10px] text-slate-300">
                Duração: <RecordingTimerDisplay className="font-mono font-bold text-amber-300" /> •{" "}
                {isInterrupted
                  ? "Os trechos de áudio foram salvos periodicamente. Retome ou finalize para gerar a ata."
                  : "Mantenha a página aberta e visível durante a gravação."}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={handleRetakeMeeting}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md transition-all active:scale-95"
            >
              <span>{isInterrupted ? "Continuar gravação" : "Voltar para tela de gravação"}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setShowConfirmModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-600/80 hover:bg-rose-600 text-white text-xs font-semibold shadow-md transition-all active:scale-95"
            >
              <Square className="w-3 h-3 fill-current" />
              <span>{isInterrupted ? "Recuperar e Salvar" : "Encerrar reunião"}</span>
            </button>
          </div>
        </div>
      )}

      {showConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-5">
            <div className="flex items-center gap-3 text-rose-400">
              <div className="w-10 h-10 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-white">
                {isInterrupted ? "Recuperar e finalizar gravação?" : "Tem certeza de que deseja encerrar a gravação?"}
              </h3>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Todos os trechos de áudio salvos periodicamente serão consolidados para gerar a transcrição completa e o resumo por IA na sua conta.
            </p>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                disabled={isFinishing}
                onClick={() => setShowConfirmModal(false)}
                className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs transition-all active:scale-95"
              >
                Voltar
              </button>
              <button
                disabled={isFinishing}
                onClick={confirmFinishMeeting}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs shadow-lg shadow-rose-600/30 transition-all active:scale-95"
              >
                {isFinishing ? (
                  <span>Processando e salvando...</span>
                ) : (
                  <>
                    <Square className="w-3.5 h-3.5 fill-current" />
                    <span>{isInterrupted ? "Recuperar e Salvar" : "Encerrar reunião"}</span>
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
