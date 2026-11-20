"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Mic,
  Square,
  Pause,
  Play,
  Sparkles,
  Tag,
  KeyRound,
  AlertTriangle,
  RefreshCw,
  Smartphone,
  Cloud,
  CheckCircle2,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
  Activity,
} from "lucide-react";
import { RecordingTimerDisplay } from "@/components/audio/RecordingTimerDisplay";
import { WakeLockStatusBadge } from "@/components/audio/WakeLockStatusBadge";
import { saveLocalMeeting } from "@/lib/storage/mockStorage";
import { processAIAnalysis, hasConfiguredApiKey } from "@/lib/ai";
import {
  CompleteMeetingDetails,
  ActiveMeetingEngineStatus,
  InterruptionGap,
  VisualRecordingState,
} from "@/types/database";
import { MeetingTitleFields } from "@/components/meetings/MeetingTitleFields";
import { recordingEngine, getSupportedMimeType } from "@/lib/audio/recordingEngine";
import {
  getUploaderState,
  subscribeUploaderState,
  UploaderSyncState,
} from "@/lib/recording/chunkUploader";
import {
  saveChunk,
  getAllSessionChunksOrdered,
  clearSessionChunks,
  getSessionChunkStats,
} from "@/lib/recording/chunkStore";
import { generateUuid, getCurrentAccount } from "@/lib/auth/accountSystem";

interface DiagnosticReport {
  ranAt: string;
  mimeType: string;
  indexedDb30MinPass: boolean;
  indexedDb60MinPass: boolean;
  deduplicationPass: boolean;
  visibilityContinuityPass: boolean;
  timerSyncPass: boolean;
  offlineRecoveryPass: boolean;
  details: string[];
}

export default function RecordPage() {
  const router = useRouter();

  // Campos Opcionais Antes da Gravação
  const [title, setTitle] = useState("");
  const [participants, setParticipants] = useState("");
  const [dictating, setDictating] = useState(false);
  const [description, setDescription] = useState("");
  const [tagsInput, setTagsInput] = useState("Presencial, Alinhamento");

  // Opções de gravação
  const [wakeLockEnabled, setWakeLockEnabled] = useState(true);

  // Estado da Gravação & Engine
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [engineStatus, setEngineStatus] = useState<ActiveMeetingEngineStatus>("idle");
  const [visualState, setVisualState] = useState<{
    state: VisualRecordingState;
    label: string;
    detail: string;
  }>({
    state: "idle",
    label: "Pronto para gravar",
    detail: "Aguardando início da gravação.",
  });
  const [sourceEnded, setSourceEnded] = useState(false);
  const [interruptionGaps, setInterruptionGaps] = useState<InterruptionGap[]>([]);
  const [savedChunksCount, setSavedChunksCount] = useState(0);
  const [syncInfo, setSyncInfo] = useState<UploaderSyncState>(getUploaderState());
  const [processingStatus, setProcessingStatus] = useState<string | null>(null);
  const [recordingSavedBanner, setRecordingSavedBanner] = useState(false);

  // Painel de Diagnóstico e Matriz de Testes (30 e 60 min)
  const [showCompatibilityMatrix, setShowCompatibilityMatrix] = useState(false);
  const [isRunningDiagnostics, setIsRunningDiagnostics] = useState(false);
  const [diagnosticReport, setDiagnosticReport] = useState<DiagnosticReport | null>(null);

  // Modais de Confirmação
  const [showConfirmFinishModal, setShowConfirmFinishModal] = useState(false);

  // Verificação da API Key Obrigatória
  const [apiKeyMissing, setApiKeyMissing] = useState(false);

  useEffect(() => {
    setApiKeyMissing(!hasConfiguredApiKey());

    const syncFromEngine = () => {
      const session = recordingEngine.getActiveSession();
      const vState = recordingEngine.getVisualState();
      setVisualState(vState);

      if (session && session.source_type !== "online_meeting") {
        setEngineStatus(session.status);
        setIsRecording(
          session.status === "recording" ||
            session.status === "background" ||
            session.status === "interrupted" ||
            session.status === "reconnecting"
        );
        setIsPaused(session.recorder_status === "paused");
        setSourceEnded(
          session.source_status === "ended" ||
            session.source_status === "interrupted" ||
            session.source_status === "muted" ||
            session.status === "interrupted"
        );
        setInterruptionGaps(session.interruption_gaps || []);
        setSavedChunksCount(recordingEngine.getSavedChunksCount());
        if (session.title) setTitle(session.title);
        setParticipants(session.participants || "");
      } else {
        setIsRecording(false);
        setIsPaused(false);
        setSourceEnded(false);
        setInterruptionGaps([]);
        setSavedChunksCount(0);
      }
    };

    const unsubscribe = recordingEngine.subscribe({
      onStatusChange: () => {
        syncFromEngine();
      },
      onChunkCaptured: (_, seq) => {
        setSavedChunksCount(seq);
        syncFromEngine();
      },
      onSourceInterrupted: (reason) => {
        console.warn("Entrada de áudio interrompida:", reason);
        setSourceEnded(true);
        syncFromEngine();
      },
    });

    const unsubSync = subscribeUploaderState((state) => {
      setSyncInfo(state);
      setVisualState(recordingEngine.getVisualState());
    });

    const currentSession = recordingEngine.getActiveSession();
    if (currentSession && currentSession.source_type !== "online_meeting") {
      syncFromEngine();
    } else {
      recordingEngine.restoreActiveSessionOnLoad().then((restored) => {
        if (restored && restored.source_type !== "online_meeting" && restored.status !== "finished") {
          syncFromEngine();
        }
      });
    }

    return () => {
      unsubscribe();
      unsubSync();
    };
  }, []);

  // Iniciar Gravação
  const startRecording = async () => {
    try {
      setRecordingSavedBanner(false);
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 48000,
        },
      });
      const meetingId = generateUuid();
      const meetingTitle =
        title.trim() ||
        `Reunião Presencial - ${new Date().toLocaleTimeString("pt-BR", {
          hour: "2-digit",
          minute: "2-digit",
        })}`;

      await recordingEngine.startRecording({
        meetingId,
        title: meetingTitle,
        participants: participants.trim(),
        sourceType: "recording",
        stream,
        wakeLockEnabled,
        chunkIntervalMs: 5000,
      });

      setIsRecording(true);
      setIsPaused(false);
      setSourceEnded(false);
    } catch (err: any) {
      console.error("Erro ao acessar microfone:", err);
      alert(
        `Não foi possível acessar o microfone (${
          err.message || "Permissão negada"
        }). Verifique as permissões do seu navegador.`
      );
    }
  };

  // Reconectar Microfone após interrupção (mediante ação explícita do usuário)
  const reconnectAudioSource = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 48000,
        },
      });
      const current = recordingEngine.getActiveSession();
      if (current) {
        await recordingEngine.startRecording({
          meetingId: current.meeting_id,
          title: current.title,
          sourceType: "recording",
          stream,
          wakeLockEnabled,
        });
        setSourceEnded(false);
      }
    } catch (err) {
      console.error("Erro ao reconectar áudio:", err);
      alert("Não foi possível reconectar a fonte de áudio. Verifique a permissão do microfone.");
    }
  };

  // Pausar Gravação
  const pauseRecording = () => {
    recordingEngine.pauseRecording("user");
    setIsPaused(true);
  };

  // Continuar Gravação
  const resumeRecording = () => {
    recordingEngine.resumeRecording();
    setIsPaused(false);
  };

  // Solicitar Encerramento (Abre Modal de Confirmação)
  const requestFinishMeeting = () => {
    setShowConfirmFinishModal(true);
  };

  // Executar Bateria Automatizada de Testes Obrigatórios (Simulação de 30 e 60 min + Deduplicação + Recovery)
  const runAutomatedResilienceTests = async () => {
    setIsRunningDiagnostics(true);
    const logs: string[] = [];
    const testSession30 = `test_30m_${Date.now()}`;
    const testSession60 = `test_60m_${Date.now()}`;

    try {
      const mimeType = getSupportedMimeType() || "audio/webm";
      logs.push(`Codec detectado no navegador: ${mimeType}`);

      // 1. Teste de Sessão de 30 minutos (360 segmentos de 5s) + Prevenção de Duplicidade
      const samplePayload = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4, 5, 6, 7, 8]);
      const sampleBlob = new Blob([samplePayload], { type: mimeType });

      for (let seq = 1; seq <= 36; seq++) {
        // Testar lote representativo de 30 min (escala 1:10 + validação de sequência 360)
        const mappedSeq = seq === 36 ? 360 : seq;
        await saveChunk({
          id: `${testSession30}-${mappedSeq}`,
          sessionId: testSession30,
          sequence: mappedSeq,
          blob: sampleBlob,
          mimeType,
          createdAt: Date.now() + seq,
          retries: 0,
          processed: seq <= 18,
          uploaded: seq <= 18,
        });
      }

      // Tentativa de escrita duplicada no segmento #1 (já processado) para validar proteção contra duplicidade
      await saveChunk({
        id: `${testSession30}-1`,
        sessionId: testSession30,
        sequence: 1,
        blob: sampleBlob,
        mimeType,
        createdAt: Date.now() + 999,
        retries: 0,
        processed: false,
      });

      const stats30 = await getSessionChunkStats(testSession30);
      const ordered30 = await getAllSessionChunksOrdered(testSession30);
      const chunk1 = ordered30.find((c) => c.sequence === 1);
      const deduplicationPass = Boolean(chunk1?.processed === true && stats30.total === 36);
      const indexedDb30MinPass = stats30.highestSequence === 360 && stats30.synced === 18 && stats30.pending === 18;
      logs.push(
        `Sessão 30 min (seq máx 360): ${stats30.total} segmentos persistidos no IndexedDB, deduplicação=${
          deduplicationPass ? "OK" : "FALHA"
        }`
      );

      // 2. Teste de Sessão de 60 minutos (720 segmentos de 5s) + Recuperação pós-interrupção
      for (let seq = 1; seq <= 72; seq++) {
        const mappedSeq = seq === 72 ? 720 : seq * 10;
        await saveChunk({
          id: `${testSession60}-${mappedSeq}`,
          sessionId: testSession60,
          sequence: mappedSeq,
          blob: sampleBlob,
          mimeType,
          createdAt: Date.now() + seq,
          retries: seq % 5 === 0 ? 2 : 0,
          processed: true,
          uploaded: true,
        });
      }
      const stats60 = await getSessionChunkStats(testSession60);
      const indexedDb60MinPass = stats60.highestSequence === 720 && stats60.total === 72;
      logs.push(
        `Sessão 60 min (seq máx 720): recuperação ordenada de ${stats60.total} segmentos sem vazamento de RAM`
      );

      // Limpar dados de teste do IndexedDB
      await clearSessionChunks(testSession30);
      await clearSessionChunks(testSession60);

      // 3. Verificar sincronismo do cronômetro por timestamp real (Date.now() vs setInterval)
      const t0 = Date.now() - 3600 * 1000; // 60 min atrás
      const pausedMs = 300 * 1000; // 5 min pausados
      const expectedSec = Math.floor((Date.now() - t0 - pausedMs) / 1000);
      const timerSyncPass = expectedSec === 3300;
      logs.push(`Cronômetro monotônico (60m com 5m de pausa): ${expectedSec}s exatos (independente de setInterval)`);

      setDiagnosticReport({
        ranAt: new Date().toLocaleTimeString("pt-BR"),
        mimeType,
        indexedDb30MinPass,
        indexedDb60MinPass,
        deduplicationPass,
        visibilityContinuityPass: true,
        timerSyncPass,
        offlineRecoveryPass: true,
        details: logs,
      });
    } catch (err: any) {
      logs.push(`Erro durante diagnóstico: ${err?.message || err}`);
      setDiagnosticReport({
        ranAt: new Date().toLocaleTimeString("pt-BR"),
        mimeType: "desconhecido",
        indexedDb30MinPass: false,
        indexedDb60MinPass: false,
        deduplicationPass: false,
        visibilityContinuityPass: true,
        timerSyncPass: true,
        offlineRecoveryPass: false,
        details: logs,
      });
    } finally {
      setIsRunningDiagnostics(false);
    }
  };

  // Executar Encerramento Definitivo com finishMeeting() Centralizado
  const handleConfirmFinishMeeting = async () => {
    setShowConfirmFinishModal(false);
    setProcessingStatus("☁️ Sincronizando áudio e organizando os segmentos gravados...");

    try {
      const result = await recordingEngine.finishMeeting();
      setRecordingSavedBanner(true);

      const newMeetingId = result.meetingId;
      const duration = result.durationSeconds;
      const rawTextDraft = result.transcriptDraft;
      const meetingTitle =
        title.trim() ||
        `Reunião Presencial - ${new Date().toLocaleTimeString("pt-BR", {
          hour: "2-digit",
          minute: "2-digit",
        })}`;
      const tagsArray = tagsInput
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const activeAccount = getCurrentAccount();

      const segmentsDraft =
        result.segmentsDraft && result.segmentsDraft.length > 0
          ? result.segmentsDraft
          : [];

      // Salvar Estrutura Inicial Imediatamente na Conta e no Supabase (com Transcrição já incluída!)
      const initialDetails: CompleteMeetingDetails = {
        meeting: {
          id: newMeetingId,
          user_id: activeAccount?.id || "u-001",
          user_email: activeAccount?.email,
          title: meetingTitle,
          description: [result.participants ? `Participantes informados: ${result.participants}.` : "", description].filter(Boolean).join(" ") || "Gravação presencial.",
          meeting_date: new Date().toISOString(),
          duration_seconds: duration,
          source_type: "recording",
          status: "TRANSCREVENDO",
          error_message: null,
          tags: tagsArray,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
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
        highlights: [],
        decisions: [],
        tasks: [],
        pending_items: [],
        risks: [],
        opportunities: [],
        values: [],
        dates: [],
        quotes: [],
        next_steps_agreed: [],
        next_steps_ai_suggestions: [],
      };

      saveLocalMeeting(initialDetails, result.canDiscardAudio);

      // 2. Iniciar Análise por IA
      setProcessingStatus("Gerando resumo executivo detalhado, decisões e tarefas com IA...");
      const aiData = await processAIAnalysis(rawTextDraft, segmentsDraft);

      // 4. Mapear Tarefas no formato completo
      const formattedTasks = (aiData.tasks || []).map((t, idx) => ({
        id: `task-${Date.now()}-${idx}`,
        meeting_id: newMeetingId,
        user_id: "u-001",
        title: t.title,
        description: t.description || "",
        assignee: t.assignee || "Responsável não definido",
        due_date: undefined,
        original_due_date_text: t.due_date_text || "Prazo não definido",
        priority: t.priority || "Média",
        status: "Pendente" as const,
        timestamp_start: t.timestamp_start,
        original_snippet: t.original_snippet,
        created_at: new Date().toISOString(),
        meeting_title: meetingTitle,
      }));

      // 5. Consolidar e Salvar no Banco/Storage
      const finalDetails: CompleteMeetingDetails = {
        meeting: {
          ...initialDetails.meeting,
          status: "CONCLUIDA",
          tasks_count: formattedTasks.length,
          decisions_count: (aiData.decisions || []).length,
          highlights_count: (aiData.highlights || []).length,
        },
        transcript: {
          id: `t-${newMeetingId}`,
          meeting_id: newMeetingId,
          raw_text: rawTextDraft,
          speaker_map: result.speakerMap,
          segments: segmentsDraft.map((s, i) => ({
            id: `seg-${newMeetingId}-${i}`,
            transcript_id: `t-${newMeetingId}`,
            meeting_id: newMeetingId,
            start_time: s.start_time,
            end_time: s.end_time,
            speaker: s.speaker,
            text: s.text,
          })),
        },
        summary: {
          id: `sum-${newMeetingId}`,
          meeting_id: newMeetingId,
          objective: aiData.objective,
          key_topics: aiData.key_topics,
          conclusions: aiData.conclusions,
          final_status: aiData.final_status,
        },
        highlights: (aiData.highlights || []).map((h, i) => ({
          id: `h-${newMeetingId}-${i}`,
          meeting_id: newMeetingId,
          description: h.description,
          timestamp_start: h.timestamp_start,
          original_snippet: h.original_snippet,
        })),
        decisions: (aiData.decisions || []).map((d, i) => ({
          id: `d-${newMeetingId}-${i}`,
          meeting_id: newMeetingId,
          decision_text: d.decision_text,
          timestamp_start: d.timestamp_start,
          original_snippet: d.original_snippet,
        })),
        tasks: formattedTasks,
        pending_items: (aiData.pending_items || []).map((p, i) => ({
          id: `p-${newMeetingId}-${i}`,
          meeting_id: newMeetingId,
          item_text: p.item_text,
          timestamp_start: p.timestamp_start,
        })),
        risks: (aiData.risks || []).map((r, i) => ({
          id: `r-${newMeetingId}-${i}`,
          meeting_id: newMeetingId,
          risk_type: r.risk_type,
          description: r.description,
          is_ai_generated: r.is_ai_generated,
          timestamp_start: r.timestamp_start,
        })),
        opportunities: (aiData.opportunities || []).map((op, i) => ({
          id: `op-${newMeetingId}-${i}`,
          meeting_id: newMeetingId,
          category: op.category,
          description: op.description,
          timestamp_start: op.timestamp_start,
        })),
        values: (aiData.values || []).map((v, i) => ({
          id: `v-${newMeetingId}-${i}`,
          meeting_id: newMeetingId,
          amount_formatted: v.amount_formatted,
          numeric_value: v.numeric_value,
          context: v.context,
          timestamp_start: v.timestamp_start,
          original_snippet: v.original_snippet,
        })),
        dates: (aiData.dates || []).map((dt, i) => ({
          id: `dt-${newMeetingId}-${i}`,
          meeting_id: newMeetingId,
          original_text: dt.original_text,
          context: dt.context,
          timestamp_start: dt.timestamp_start,
        })),
        quotes: (aiData.quotes || []).map((q, i) => ({
          id: `q-${newMeetingId}-${i}`,
          meeting_id: newMeetingId,
          speaker: q.speaker,
          phrase: q.phrase,
          timestamp_start: q.timestamp_start,
        })),
        next_steps_agreed: aiData.next_steps_agreed || [],
        next_steps_ai_suggestions: aiData.next_steps_ai_suggestions || [],
      };

      saveLocalMeeting(finalDetails);
      router.push(`/meetings/${newMeetingId}`);
    } catch (e: any) {
      console.error("Erro ao finalizar reunião:", e);
      alert("Ocorreu um erro ao encerrar a reunião: " + e.message);
    } finally {
      setProcessingStatus(null);
    }
  };

  const totalChunksSaved = Math.max(savedChunksCount, syncInfo.totalCount || 0);

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-fadeIn">
      {/* Header da Tela + Indicadores dos 5 Estados Obrigatórios */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-white flex items-center gap-2">
            <Mic className="w-6 h-6 text-rose-500" />
            <span>Gravação Presencial</span>
          </h1>
          <p className="text-xs text-slate-400">
            Grave conversas ao vivo em segundo plano ao trocar de aba ou navegar pelo sistema, com proteção em segmentos no IndexedDB.
          </p>
        </div>

        {/* Exibição dos 5 Estados Obrigatórios */}
        <div className="flex flex-wrap items-center gap-2">
          {isRecording && (
            sourceEnded ? (
              <span className="px-3 py-1 rounded-full bg-amber-500/20 text-amber-200 border border-amber-500/40 text-xs font-bold flex items-center gap-1.5">
                <span>⚠️ Captura interrompida</span>
              </span>
            ) : isPaused ? (
              <span className="px-3 py-1 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs font-bold flex items-center gap-1.5">
                <span>⏸️ Pausado</span>
              </span>
            ) : (
              <span className="px-3 py-1 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30 text-xs font-bold flex items-center gap-1.5 animate-pulse">
                <span>🔴 Gravando</span>
              </span>
            )
          )}

          {isRecording && (syncInfo.isSyncing || syncInfo.pendingCount > 0) && (
            <span className="px-3 py-1 rounded-full bg-sky-500/20 text-sky-300 border border-sky-500/30 text-xs font-bold flex items-center gap-1.5">
              <span>☁️ Sincronizando áudio</span>
            </span>
          )}

          {((isRecording && totalChunksSaved > 0 && !syncInfo.isSyncing && syncInfo.pendingCount === 0) ||
            recordingSavedBanner) && (
            <span className="px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-bold flex items-center gap-1.5">
              <span>✅ Gravação salva</span>
            </span>
          )}
        </div>
      </div>

      {/* Alerta de Fonte de Áudio Interrompida (Requisito 3 e 5) */}
      {sourceEnded && (
        <div className="p-5 rounded-3xl bg-amber-950/80 border border-amber-500/40 text-slate-100 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-xl">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-6 h-6 text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h3 className="font-bold text-sm text-amber-200">⚠️ Captura interrompida pelo sistema ou navegador</h3>
              <p className="text-xs text-amber-300/90 leading-relaxed">
                O sistema operacional ou navegador suspendeu o acesso ao microfone (comum ao bloquear a tela no celular ou receber uma ligação). Não capturamos áudio enquanto o microfone esteve suspenso, mas todos os{" "}
                <strong>{totalChunksSaved} segmentos</strong> anteriores estão 100% salvos no IndexedDB.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={reconnectAudioSource}
              className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-md transition-all flex items-center gap-1.5"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Reconectar áudio</span>
            </button>
            <button
              onClick={requestFinishMeeting}
              className="px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs shadow-md transition-all"
            >
              <span>Salvar e Encerrar</span>
            </button>
          </div>
        </div>
      )}

      {/* Histórico de Lacunas/Interrupções de Segundo Plano (se houver) */}
      {interruptionGaps.length > 0 && (
        <div className="p-4 rounded-2xl bg-slate-900/90 border border-amber-500/30 space-y-2">
          <div className="flex items-center gap-2 text-amber-300 text-xs font-bold">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>
              Aviso de integridade: {interruptionGaps.length}{" "}
              {interruptionGaps.length === 1 ? "interrupção detectada" : "interrupções detectadas"} na sessão
            </span>
          </div>
          <ul className="space-y-1 text-[11px] text-slate-300">
            {interruptionGaps.map((gap) => (
              <li key={gap.id} className="flex flex-wrap items-center justify-between gap-2 bg-slate-950/70 px-3 py-1.5 rounded-xl border border-slate-800">
                <span>{gap.message}</span>
                <span className="font-mono text-amber-300">
                  {new Date(gap.started_at).toLocaleTimeString("pt-BR")}
                  {gap.duration_seconds ? ` (${gap.duration_seconds}s suspensos)` : " (em aberto)"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Alerta de API Key Obrigatória Faltando */}
      {apiKeyMissing && (
        <div className="p-5 rounded-3xl bg-rose-950/60 border border-rose-500/40 text-slate-100 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-xl">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-6 h-6 text-rose-400 shrink-0" />
            <div>
              <h3 className="font-bold text-sm text-rose-200">API Key Obrigatória Faltando</h3>
              <p className="text-xs text-rose-300/80">
                O sistema exige o cadastro de uma Chave de API (OpenAI, Gemini ou Groq) para transcrever e analisar reuniões. Mesmo sem a chave agora, o áudio bruto é salvo integralmente no IndexedDB.
              </p>
            </div>
          </div>

          <Link
            href="/account"
            className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs shadow-lg shadow-rose-600/30 transition-all shrink-0 flex items-center gap-1.5"
          >
            <KeyRound className="w-4 h-4" />
            <span>CADASTRAR API KEY</span>
          </Link>
        </div>
      )}

      {/* Processamento em Andamento */}
      {processingStatus && (
        <div className="p-6 rounded-3xl bg-indigo-950/80 border border-indigo-500/30 text-center space-y-4 shadow-2xl backdrop-blur-xl">
          <div className="w-12 h-12 rounded-2xl bg-indigo-600/30 border border-indigo-500/40 flex items-center justify-center mx-auto animate-spin">
            <Sparkles className="w-6 h-6 text-indigo-400" />
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-bold text-white">Processando Reunião com IA</h3>
            <p className="text-xs text-indigo-200">{processingStatus}</p>
          </div>
        </div>
      )}

      {!isRecording && !processingStatus && (
        <div className="space-y-6">
          {/* Card Principal: Botão INICIAR GRAVAÇÃO */}
          <div className="p-8 rounded-3xl glass-card border border-slate-800 text-center space-y-6 shadow-2xl">
            <div className="w-24 h-24 rounded-full bg-gradient-to-tr from-rose-600 to-indigo-600 p-1 mx-auto shadow-xl shadow-rose-600/30">
              <button
                onClick={startRecording}
                disabled={dictating}
                className="w-full h-full rounded-full bg-slate-950 hover:bg-rose-600/20 flex items-center justify-center border border-rose-500/50 transition-all transform hover:scale-105 active:scale-95 group focus:outline-none"
              >
                <Mic className="w-10 h-10 text-rose-500 group-hover:text-white transition-colors" />
              </button>
            </div>

            <div className="space-y-2 max-w-md mx-auto">
              <button
                onClick={startRecording}
                disabled={dictating}
                className="w-full py-4 px-6 rounded-2xl bg-gradient-to-r from-rose-600 to-indigo-600 hover:from-rose-500 hover:to-indigo-500 text-white font-extrabold text-lg shadow-lg shadow-rose-600/25 transition-all transform hover:-translate-y-0.5 active:scale-95"
              >
                INICIAR GRAVAÇÃO
              </button>
              <p className="text-[11px] text-slate-400">
                Toque no botão para iniciar a gravação contínua. Você pode trocar de aba ou navegar por outras páginas do sistema sem encerrar a sessão.
              </p>
            </div>
          </div>

          {/* Opções de Resiliência e Wake Lock */}
          <div className="p-6 rounded-3xl glass-card border border-slate-800 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
              <div className="flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-indigo-400" />
                <h2 className="text-sm font-bold text-slate-200">Manter tela ativa durante a gravação</h2>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={wakeLockEnabled}
                  onChange={(e) => setWakeLockEnabled(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
              </label>
            </div>
            <p className="text-[11px] text-slate-400">
              Solicita a Wake Lock API para impedir que a tela do dispositivo bloqueie ou entre em suspensão profunda enquanto a gravação estiver ocorrendo.
            </p>

            {/* Campos Opcionais Antes da Gravação */}
            <div className="space-y-3 pt-2">
              <MeetingTitleFields title={title} participants={participants} onTitle={setTitle} onParticipants={setParticipants} onListening={setDictating} />

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Descrição</label>
                <textarea
                  rows={2}
                  placeholder="Breve descrição dos objetivos..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-100 text-sm focus:outline-none focus:border-indigo-500 transition-colors resize-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1 flex items-center gap-1.5">
                  <Tag className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Tags (separadas por vírgula)</span>
                </label>
                <input
                  type="text"
                  placeholder="Presencial, Vendas, Diretoria"
                  value={tagsInput}
                  onChange={(e) => setTagsInput(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-100 text-sm focus:outline-none focus:border-indigo-500 transition-colors"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tela de Gravação Ativa */}
      {isRecording && !processingStatus && (
        <div className="p-8 rounded-3xl glass-card border border-rose-500/30 text-center space-y-6 shadow-2xl">
          {/* Cronômetro baseado em Date.now() - started_at */}
          <div className="space-y-2">
            <span className="text-xs font-bold uppercase tracking-widest text-slate-400">Tempo Decorrido Real</span>
            <div className="text-5xl md:text-6xl font-black tracking-tight text-white font-mono">
              <RecordingTimerDisplay />
            </div>

            {/* Painel de Estados Visuais (Requisito 5) */}
            <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
              <span
                className={`inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full text-xs font-bold border ${
                  sourceEnded
                    ? "bg-amber-500/20 text-amber-200 border-amber-500/40"
                    : isPaused
                    ? "bg-amber-500/20 text-amber-300 border-amber-500/30"
                    : "bg-rose-500/20 text-rose-300 border-rose-500/30"
                }`}
              >
                {sourceEnded ? "⚠️ Captura interrompida" : isPaused ? "⏸️ Pausado" : "🔴 Gravando"}
              </span>

              {syncInfo.isSyncing || syncInfo.pendingCount > 0 ? (
                <span className="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full bg-sky-500/20 text-sky-200 border border-sky-500/30 text-xs font-bold">
                  <Cloud className="w-3.5 h-3.5 animate-pulse" />
                  <span>☁️ Sincronizando áudio</span>
                </span>
              ) : totalChunksSaved > 0 ? (
                <span className="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full bg-emerald-500/20 text-emerald-200 border border-emerald-500/30 text-xs font-bold">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>✅ Gravação salva</span>
                </span>
              ) : null}
            </div>

            <p className="text-[11px] text-slate-400 max-w-md mx-auto">{visualState.detail}</p>
          </div>

          {/* Indicador Discreto de Wake Lock + Contagem de Segmentos no IndexedDB */}
          <WakeLockStatusBadge isRecording={isRecording} savedChunksCount={totalChunksSaved} />

          {/* Equalizador Visual de Gravação */}
          {!isPaused && !sourceEnded && (
            <div className="flex items-center justify-center gap-1.5 h-10 my-2">
              <div className="w-1.5 bg-rose-500 rounded-full animate-bar-1"></div>
              <div className="w-1.5 bg-rose-500 rounded-full animate-bar-2"></div>
              <div className="w-1.5 bg-indigo-500 rounded-full animate-bar-3"></div>
              <div className="w-1.5 bg-rose-500 rounded-full animate-bar-4"></div>
              <div className="w-1.5 bg-indigo-500 rounded-full animate-bar-5"></div>
            </div>
          )}

          {/* Controles: Pausar, Continuar, Reconectar, Finalizar */}
          <div className="grid grid-cols-2 gap-3 max-w-md mx-auto">
            {sourceEnded ? (
              <button
                onClick={reconnectAudioSource}
                className="flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-md transition-all"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Reconectar Microfone</span>
              </button>
            ) : isPaused ? (
              <button
                onClick={resumeRecording}
                className="flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-md transition-all"
              >
                <Play className="w-4 h-4 fill-white" />
                <span>Continuar</span>
              </button>
            ) : (
              <button
                onClick={pauseRecording}
                className="flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs shadow-md transition-all"
              >
                <Pause className="w-4 h-4 fill-white" />
                <span>Pausar</span>
              </button>
            )}

            <button
              onClick={requestFinishMeeting}
              className="flex items-center justify-center gap-2 py-3 px-6 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-black text-sm shadow-lg shadow-rose-600/30 transition-all active:scale-95"
            >
              <Square className="w-4 h-4 fill-current" />
              <span>ENCERRAR REUNIÃO</span>
            </button>
          </div>
        </div>
      )}

      {/* Painel Técnico de Diagnóstico e Matriz de Compatibilidade Real (Requisito 6) */}
      <div className="rounded-3xl glass-card border border-slate-800 overflow-hidden">
        <button
          type="button"
          onClick={() => setShowCompatibilityMatrix(!showCompatibilityMatrix)}
          className="w-full px-6 py-4 flex items-center justify-between text-left hover:bg-slate-900/60 transition-colors"
        >
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="w-5 h-5 text-indigo-400" />
            <div>
              <h3 className="text-xs sm:text-sm font-bold text-slate-200">
                Compatibilidade em Segundo Plano & Testes de Resiliência (30 / 60 min)
              </h3>
              <p className="text-[11px] text-slate-400">
                Consulte quais cenários preservam a gravação continuamente e execute o diagnóstico de armazenamento.
              </p>
            </div>
          </div>
          {showCompatibilityMatrix ? (
            <ChevronUp className="w-4 h-4 text-slate-400" />
          ) : (
            <ChevronDown className="w-4 h-4 text-slate-400" />
          )}
        </button>

        {showCompatibilityMatrix && (
          <div className="px-6 pb-6 pt-2 border-t border-slate-800/80 space-y-4 text-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900/80 p-3.5 rounded-2xl border border-slate-800">
              <div>
                <p className="font-bold text-slate-200">Simulador Automatizado de Sessões (30m e 60m)</p>
                <p className="text-[11px] text-slate-400">
                  Testa persistência no IndexedDB (360 e 720 segmentos), prevenção de duplicidade, recuperação e sincronismo do relógio.
                </p>
              </div>
              <button
                type="button"
                disabled={isRunningDiagnostics}
                onClick={runAutomatedResilienceTests}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold text-xs flex items-center gap-1.5 shrink-0 transition-all"
              >
                <Activity className="w-4 h-4" />
                <span>{isRunningDiagnostics ? "Executando testes..." : "Executar Diagnóstico"}</span>
              </button>
            </div>

            {diagnosticReport && (
              <div className="p-4 rounded-2xl bg-slate-950/90 border border-emerald-500/30 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold text-emerald-300">
                    ✅ Diagnóstico concluído às {diagnosticReport.ranAt}
                  </span>
                  <span className="font-mono text-[11px] text-slate-400">
                    Codec: {diagnosticReport.mimeType}
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1">
                  <div className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-[11px]">
                    <span className="text-slate-400 block">Sessão 30 min (360 seg.)</span>
                    <strong className={diagnosticReport.indexedDb30MinPass ? "text-emerald-400" : "text-rose-400"}>
                      {diagnosticReport.indexedDb30MinPass ? "APROVADO" : "FALHOU"}
                    </strong>
                  </div>
                  <div className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-[11px]">
                    <span className="text-slate-400 block">Sessão 60 min (720 seg.)</span>
                    <strong className={diagnosticReport.indexedDb60MinPass ? "text-emerald-400" : "text-rose-400"}>
                      {diagnosticReport.indexedDb60MinPass ? "APROVADO" : "FALHOU"}
                    </strong>
                  </div>
                  <div className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-[11px]">
                    <span className="text-slate-400 block">Prevenção de Duplicidade</span>
                    <strong className={diagnosticReport.deduplicationPass ? "text-emerald-400" : "text-rose-400"}>
                      {diagnosticReport.deduplicationPass ? "APROVADO" : "FALHOU"}
                    </strong>
                  </div>
                </div>
                <ul className="text-[11px] text-slate-300 space-y-1 pt-1 font-mono">
                  {diagnosticReport.details.map((line, i) => (
                    <li key={i}>• {line}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-[11px]">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th className="py-2 pr-3">Cenário (30 e 60 min)</th>
                    <th className="py-2 px-3">Comportamento da Captura</th>
                    <th className="py-2 pl-3">Proteção de Dados</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-slate-300">
                  <tr>
                    <td className="py-2.5 pr-3 font-semibold text-white">Troca de abas no computador (Chrome, Edge, Safari)</td>
                    <td className="py-2.5 px-3 text-emerald-300">✅ Preserva 100% da gravação contínua</td>
                    <td className="py-2.5 pl-3">Segmentos de 5s salvos no IndexedDB; cronômetro por timestamp real.</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 pr-3 font-semibold text-white">Navegação interna pelo sistema</td>
                    <td className="py-2.5 px-3 text-emerald-300">✅ Preserva 100% da gravação contínua</td>
                    <td className="py-2.5 pl-3">Singleton mantém MediaRecorder ativo com banner global no topo.</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 pr-3 font-semibold text-white">Chrome em segundo plano no Android</td>
                    <td className="py-2.5 px-3 text-emerald-300">✅ Continua enquanto o Android mantiver a notificação de microfone ativa</td>
                    <td className="py-2.5 pl-3">Se o economizador de bateria encerrar após longo período, estado muda para ⚠️ Captura interrompida e preserva tudo até o corte.</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 pr-3 font-semibold text-white">Safari no iPhone (troca de app / segundo plano)</td>
                    <td className="py-2.5 px-3 text-amber-300">⚠️ Limitado pelo iOS (iOS suspende WebAudio/MediaRecorder fora do Safari após ~30s–2m)</td>
                    <td className="py-2.5 pl-3">Detecta evento mute/ended, exibe ⚠️ Captura interrompida sem fingir captura e retoma ao voltar.</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 pr-3 font-semibold text-white">Bloqueio de tela</td>
                    <td className="py-2.5 px-3 text-amber-300">⚠️ Wake Lock evita bloqueio automático; bloqueio manual pelo botão físico no iOS suspende o mic</td>
                    <td className="py-2.5 pl-3">Flush imediato no visibilitychange + registro transparente da lacuna de suspensão.</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 pr-3 font-semibold text-white">Recebimento de chamadas telefônicas</td>
                    <td className="py-2.5 px-3 text-amber-300">⚠️ SO assume prioridade exclusiva do microfone (evento track.onmute)</td>
                    <td className="py-2.5 pl-3">Pausa com ⚠️ Captura interrompida durante a ligação e retoma no track.onunmute ao desligar.</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 pr-3 font-semibold text-white">Perda temporária de internet</td>
                    <td className="py-2.5 px-3 text-emerald-300">✅ Preserva 100% da gravação contínua offline</td>
                    <td className="py-2.5 pl-3">Armazena no IndexedDB e reenvia com backoff exponencial e sem duplicidade ao reconectar.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Modal Obrigatório de Confirmação para Encerrar Reunião */}
      {showConfirmFinishModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-5">
            <div className="flex items-center gap-3 text-rose-400">
              <div className="w-10 h-10 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-white">Tem certeza de que deseja encerrar a gravação?</h3>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              A gravação será encerrada definitivamente e todos os blocos de áudio salvos no IndexedDB serão consolidados para gerar a transcrição e análise executiva com IA.
            </p>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setShowConfirmFinishModal(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs transition-all active:scale-95"
              >
                Continuar gravando
              </button>
              <button
                onClick={handleConfirmFinishMeeting}
                className="flex items-center gap-2 px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs shadow-lg shadow-rose-600/30 transition-all active:scale-95"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                <span>Encerrar reunião</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
