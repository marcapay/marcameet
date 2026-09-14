"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import {
  Mic,
  Square,
  Pause,
  Play,
  X,
  Check,
  Sparkles,
  FileText,
  Copy,
  Award,
  CheckCircle2,
  ListTodo,
  Clock,
  ChevronRight,
  History,
  RotateCcw,
  Share2,
  Search,
  UserCheck,
  Edit2,
  DollarSign,
  AlertTriangle,
  Tag,
  TrendingUp,
  Download,
  ArrowRight,
  Radio
} from "lucide-react";
import { getLocalMeetings, saveLocalMeeting, updateSpeakerNameInMeeting, updateMeetingTitle } from "@/lib/storage/mockStorage";
import { processAudioTranscription, processAIAnalysis, hasConfiguredApiKey } from "@/lib/ai";
import { requestScreenWakeLock, releaseScreenWakeLock, startAudioKeepAlive, stopAudioKeepAlive } from "@/lib/audio/recordingKeepAlive";
import { CompleteMeetingDetails } from "@/types/database";
import { MediaPlayer } from "@/components/audio/MediaPlayer";
import { recordingEngine } from "@/lib/audio/recordingEngine";


export function MobileApp() {
  const [activeTab, setActiveTab] = useState<"record" | "summary" | "transcript">("summary");

  // Gravação
  const [title, setTitle] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [processingStatus, setProcessingStatus] = useState<string | null>(null);

  // Lista de reuniões e reunião selecionada para exibição de resumo
  const [meetings, setMeetings] = useState<CompleteMeetingDetails[]>([]);
  const [selectedMeeting, setSelectedMeeting] = useState<CompleteMeetingDetails | null>(null);

  // Transcrição & Player
  const [seekTime, setSeekTime] = useState<number | null>(null);
  const [transcriptSearch, setTranscriptSearch] = useState("");
  const [editingSpeaker, setEditingSpeaker] = useState<string | null>(null);
  const [newSpeakerName, setNewSpeakerName] = useState("");

  // Notificação de cópia / toast
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Renomear reunião
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editingTitleValue, setEditingTitleValue] = useState("");

  const handleSaveMeetingTitle = () => {
    if (!selectedMeeting || !editingTitleValue.trim()) return;
    const updated = updateMeetingTitle(selectedMeeting.meeting.id, editingTitleValue.trim());
    if (updated) {
      setSelectedMeeting(updated);
      reloadMeetings();
      showToast("Título da reunião atualizado!");
    }
    setIsEditingTitle(false);
  };

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number>(0);
  const accumulatedTimeRef = useRef<number>(0);

  // Carregar histórico local de reuniões
  const reloadMeetings = () => {
    const list = getLocalMeetings();
    setMeetings(list);
    if (list.length > 0) {
      // Se não tiver selecionado nada ou a lista atualizou, seleciona o mais recente
      setSelectedMeeting((prev) => {
        if (!prev) return list[0];
        const match = list.find((m) => m.meeting.id === prev.meeting.id);
        return match || list[0];
      });
    } else {
      setSelectedMeeting(null);
    }
  };

  useEffect(() => {
    reloadMeetings();
  }, []);

  // Atualizar cronômetro em tempo real baseado em Date.now()
  const updateTimer = () => {
    if (startTimeRef.current > 0) {
      const now = Date.now();
      const totalMs = accumulatedTimeRef.current + (now - startTimeRef.current);
      setSeconds(Math.floor(totalMs / 1000));
    }
  };

  // Subscrever a eventos da Engine Central de Gravação
  useEffect(() => {
    const unsubscribe = recordingEngine.subscribe({
      onStatusChange: (status, session) => {
        if (session) {
          setIsRecording(status === "recording" || status === "background" || status === "interrupted" || status === "reconnecting");
          setIsPaused(session.recorder_status === "paused");
        } else {
          setIsRecording(false);
          setIsPaused(false);
        }
      },
      onTimerTick: (sec) => {
        setSeconds(sec);
      },
    });

    const active = recordingEngine.getActiveSession();
    if (active && recordingEngine.hasLiveRecorder()) {
      setIsRecording(true);
      setIsPaused(active.recorder_status === "paused");
      setSeconds(recordingEngine.getElapsedSeconds());
    }

    return () => {
      unsubscribe();
    };
  }, []);

  const formatTimer = (totalSec: number) => {
    const hrs = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    if (hrs > 0) {
      return `${hrs.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
    }
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const formatTimestamp = (sec?: number) => {
    if (sec === undefined || sec === null) return null;
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // Iniciar Gravação com Engine Central
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const meetingId = `m-${Date.now()}`;
      const meetingTitle = title.trim() || `Reunião Presencial - ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;


      await recordingEngine.startRecording({
        meetingId,
        title: meetingTitle,
        sourceType: "recording",
        stream,
        wakeLockEnabled: true,
        chunkIntervalMs: 8000,
      });

      setIsRecording(true);
      setIsPaused(false);
    } catch (err) {
      console.error("Erro ao acessar microfone:", err);
      alert("Não foi possível acessar o microfone. Verifique as permissões do navegador.");
    }
  };

  // Pausar Gravação
  const pauseRecording = () => {
    recordingEngine.pauseRecording();
    setIsPaused(true);
  };

  // Continuar Gravação
  const resumeRecording = () => {
    recordingEngine.resumeRecording();
    setIsPaused(false);
  };

  // Cancelar Gravação
  const cancelRecording = async () => {
    if (confirm("Deseja cancelar a gravação atual? O áudio atual será encerrado.")) {
      try {
        await recordingEngine.finishMeeting();
      } catch (e) {}
      setIsRecording(false);
      setIsPaused(false);
    }
  };


  // Finalizar e Gerar Resumo Automático da Gravação
  const finishRecording = async () => {
    if (!confirm("Tem certeza de que deseja encerrar a gravação?")) return;

    try {
      setProcessingStatus("Salvando e finalizando captura de áudio...");
      const engineResult = await recordingEngine.finishMeeting();

      const duration = engineResult.durationSeconds;
      const audioBlob = engineResult.audioBlob;
      const newMeetingId = engineResult.meetingId;
      const meetingTitle = title.trim() || `Reunião Presencial - ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;

      const initialDetails: CompleteMeetingDetails = {
        meeting: {
          id: newMeetingId,
          user_id: "u-001",
          title: meetingTitle,
          description: "Gravação presencial rápida iniciada pelo dashboard principal.",
          meeting_date: new Date().toISOString(),
          duration_seconds: duration,
          source_type: "recording",
          status: "TRANSCREVENDO",
          error_message: null,
          tags: ["Presencial", "Rápida"],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
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

      saveLocalMeeting(initialDetails);

      setProcessingStatus("Transcrevendo áudio com IA...");
      const transcriptData = await processAudioTranscription(audioBlob, "gravacao_rapida.webm");

      setProcessingStatus("Gerando resumo executivo, decisões e tarefas com IA...");
      const aiData = await processAIAnalysis(transcriptData.raw_text, transcriptData.segments);



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
          raw_text: transcriptData.raw_text,
          speaker_map: transcriptData.speaker_map,
          segments: transcriptData.segments.map((s, i) => ({
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
      const updatedList = getLocalMeetings();
      setMeetings(updatedList);
      setSelectedMeeting(finalDetails);

      setIsRecording(false);
      setIsPaused(false);
      setSeconds(0);
      setTitle("");
      setProcessingStatus(null);

      // Trocar para a aba de Resumo e exibir aviso
      setActiveTab("summary");
      showToast("Resumo da reunião gerado com sucesso!");
    } catch (err: any) {
      console.error("Erro no processamento da gravação no celular:", err);
      setIsRecording(false);
      setIsPaused(false);
      setSeconds(0);
      setTitle("");
      setProcessingStatus(null);

      // Carregar e atualizar lista de reuniões salvas no celular
      const updatedList = getLocalMeetings();
      setMeetings(updatedList);
      if (updatedList.length > 0) {
        setSelectedMeeting(updatedList[0]);
      }
      setActiveTab("summary");
      showToast("Gravação salva com sucesso no celular!");
    }
  };

  // Copiar resumo completo
  const copySummaryText = () => {
    if (!selectedMeeting) return;
    const { meeting, summary, decisions, tasks } = selectedMeeting;
    const text = `📋 RESUMO DA REUNIÃO: ${meeting.title}
📅 Data: ${new Date(meeting.meeting_date).toLocaleDateString("pt-BR")}

🎯 OBJETIVO:
${summary?.objective || "Não especificado."}

💡 CONCLUSÃO:
${summary?.conclusions || "Não especificada."}

🏆 DECISÕES TOMADAS:
${decisions.length > 0 ? decisions.map((d) => `• ${d.decision_text}`).join("\n") : "• Nenhuma decisão registrada."}

✅ PRÓXIMOS PASSOS & TAREFAS:
${tasks.length > 0 ? tasks.map((t) => `• ${t.title} (Resp: ${t.assignee})`).join("\n") : "• Nenhuma tarefa atribuída."}`;

    navigator.clipboard.writeText(text);
    showToast("Resumo copiado para a área de transferência!");
  };

  // Salvar novo nome de participante
  const handleSaveSpeakerName = (oldSpeaker: string) => {
    if (!selectedMeeting || !newSpeakerName.trim()) return;
    const updated = updateSpeakerNameInMeeting(selectedMeeting.meeting.id, oldSpeaker, newSpeakerName.trim());
    if (updated) {
      setSelectedMeeting(updated);
      reloadMeetings();
      showToast(`Participante atualizado para ${newSpeakerName.trim()}`);
    }
    setEditingSpeaker(null);
    setNewSpeakerName("");
  };

  // Transcrição filtrada para a reunião selecionada
  const filteredSegments = (selectedMeeting?.transcript?.segments || []).filter(
    (seg) =>
      seg.text.toLowerCase().includes(transcriptSearch.toLowerCase()) ||
      seg.speaker.toLowerCase().includes(transcriptSearch.toLowerCase())
  );

  // MobileApp Dashboard View - Compact Container Layout
  return (
    <div className="w-full max-w-full space-y-4 sm:space-y-6 animate-fadeIn overflow-x-hidden">
      {/* Toast Notification Floating */}
      {toastMessage && (
        <div className="fixed top-16 right-4 left-4 sm:left-auto sm:right-6 z-50 p-3.5 rounded-2xl bg-emerald-600 text-white font-bold text-xs shadow-2xl flex items-center justify-center gap-2 animate-bounce">
          <Check className="w-4 h-4 shrink-0" />
          <span className="truncate">{toastMessage}</span>
        </div>
      )}

      {/* Top Header Card com Alternador de Abas em Container Único Compacto */}
      <div className="p-4 sm:p-6 rounded-3xl glass-card border border-slate-800 space-y-3.5 shadow-xl w-full max-w-full overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></span>
              <span className="text-[11px] sm:text-xs font-bold uppercase tracking-wider text-indigo-400">Inteligência de Reuniões</span>
            </div>
            <h1 className="text-xl sm:text-2xl md:text-3xl font-black text-white tracking-tight">Marca Meet</h1>
            <p className="text-xs text-slate-400">Grave reuniões ao vivo ou consulte a análise completa com IA.</p>
          </div>
        </div>

        {/* Container Único Compacto para Todos os Botões */}
        <div className="p-1 rounded-2xl bg-slate-900/90 border border-slate-800 flex items-center justify-between gap-1 w-full max-w-full overflow-hidden shadow-inner">
          <button
            onClick={() => setActiveTab("summary")}
            className={`flex-1 py-1.5 px-1.5 sm:px-3 rounded-xl font-bold text-[10px] sm:text-xs flex items-center justify-center gap-1 transition-all whitespace-nowrap ${
              activeTab === "summary"
                ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <FileText className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">Resumo</span>
          </button>

          <button
            onClick={() => setActiveTab("transcript")}
            className={`flex-1 py-1.5 px-1.5 sm:px-3 rounded-xl font-bold text-[10px] sm:text-xs flex items-center justify-center gap-1 transition-all whitespace-nowrap ${
              activeTab === "transcript"
                ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Search className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">Transcrição</span>
          </button>

          <button
            onClick={() => setActiveTab("record")}
            className={`flex-1 py-1.5 px-1.5 sm:px-3 rounded-xl font-bold text-[10px] sm:text-xs flex items-center justify-center gap-1 transition-all whitespace-nowrap ${
              activeTab === "record"
                ? "bg-gradient-to-r from-rose-600 to-indigo-600 text-white shadow-md shadow-rose-600/30"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Mic className="w-3.5 h-3.5 text-rose-400 shrink-0" />
            <span className="truncate">Gravar</span>
          </button>

          <Link
            href="/online-meet"
            className="flex-1 py-1.5 px-1.5 sm:px-3 rounded-xl font-bold text-[10px] sm:text-xs flex items-center justify-center gap-1 transition-all bg-indigo-600/80 hover:bg-indigo-500 text-white border border-indigo-500/30 active:scale-95 whitespace-nowrap"
          >
            <Radio className="w-3.5 h-3.5 text-emerald-400 animate-pulse shrink-0" />
            <span className="truncate">Online</span>
          </Link>
        </div>
      </div>

      {/* ================= ABA 1: GRAVAR REUNIÃO ================= */}
      {activeTab === "record" && (
        <div className="p-4 sm:p-6 md:p-8 rounded-3xl glass-card border border-slate-800 space-y-6 shadow-2xl animate-fadeIn w-full max-w-full overflow-hidden">
          {processingStatus ? (
            <div className="py-12 text-center space-y-4">
              <div className="w-16 h-16 rounded-2xl bg-indigo-600/30 border border-indigo-500/40 flex items-center justify-center mx-auto animate-spin">
                <Sparkles className="w-8 h-8 text-indigo-400" />
              </div>
              <div className="space-y-1">
                <h3 className="text-lg font-bold text-white">Analisando Gravação com IA</h3>
                <p className="text-xs text-indigo-200">{processingStatus}</p>
              </div>
            </div>
          ) : (
            <>
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
                <div>
                  <h2 className="text-xl font-black text-white flex items-center gap-2">
                    <Mic className="w-5 h-5 text-rose-500" />
                    <span>Gravação em Tempo Real</span>
                  </h2>
                  <p className="text-xs text-slate-400">
                    O áudio gravado será transcrevido e analisado para gerar o resumo executivo, tarefas e decisões.
                  </p>
                </div>

                {isRecording && (
                  <span className="px-3 py-1 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30 text-xs font-bold flex items-center gap-2 animate-pulse">
                    <span className="w-2 h-2 rounded-full bg-rose-500"></span>
                    Gravando Áudio...
                  </span>
                )}
              </div>

              {/* Título opcional */}
              <div className="space-y-1.5 max-w-xl">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400">
                  Título / Assunto da Reunião (Opcional)
                </label>
                <input
                  type="text"
                  disabled={isRecording}
                  placeholder="Ex: Alinhamento de Vendas & Planejamento Q3"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full px-4 py-3 rounded-2xl bg-slate-900 border border-slate-800 text-slate-100 text-sm focus:outline-none focus:border-indigo-500 transition-colors disabled:opacity-50"
                />
              </div>

              {/* Botão Principal & Display de Cronômetro */}
              <div className="py-8 text-center space-y-6">
                <div className="relative w-36 h-36 mx-auto flex items-center justify-center">
                  {isRecording && !isPaused && (
                    <div className="absolute inset-0 rounded-full bg-rose-500/20 animate-ping"></div>
                  )}
                  <button
                    onClick={isRecording ? (isPaused ? resumeRecording : pauseRecording) : startRecording}
                    className={`relative w-32 h-32 rounded-full flex items-center justify-center shadow-2xl transition-all transform hover:scale-105 active:scale-95 focus:outline-none ${
                      isRecording
                        ? isPaused
                          ? "bg-amber-600 text-white shadow-amber-600/40"
                          : "bg-rose-600 text-white shadow-rose-600/50"
                        : "bg-gradient-to-tr from-rose-600 via-indigo-600 to-indigo-500 text-white shadow-rose-600/30 hover:shadow-rose-600/50"
                    }`}
                  >
                    <Mic className={`w-14 h-14 ${isRecording && !isPaused ? "animate-pulse" : ""}`} />
                  </button>
                </div>

                <div className="space-y-1">
                  <div className="text-5xl font-black font-mono tracking-tight text-white">
                    {formatTimer(seconds)}
                  </div>
                  <p className="text-xs text-slate-400 font-medium">
                    {!isRecording
                      ? "Clique no botão para iniciar a gravação"
                      : isPaused
                      ? "Gravação pausada"
                      : "Gravando áudio..."}
                  </p>

                  {/* Visualizer simulado */}
                  {isRecording && !isPaused && (
                    <div className="flex items-center justify-center gap-1.5 h-8 pt-3">
                      <div className="w-1.5 bg-rose-500 rounded-full animate-bar-1 h-full"></div>
                      <div className="w-1.5 bg-rose-500 rounded-full animate-bar-2 h-full"></div>
                      <div className="w-1.5 bg-indigo-500 rounded-full animate-bar-3 h-full"></div>
                      <div className="w-1.5 bg-rose-500 rounded-full animate-bar-4 h-full"></div>
                      <div className="w-1.5 bg-indigo-500 rounded-full animate-bar-5 h-full"></div>
                    </div>
                  )}
                </div>
              </div>

              {/* Botões de Ação da Gravação */}
              <div className="max-w-md mx-auto pt-2">
                {!isRecording ? (
                  <button
                    onClick={startRecording}
                    className="w-full py-4 px-6 rounded-2xl bg-gradient-to-r from-rose-600 to-indigo-600 hover:from-rose-500 hover:to-indigo-500 text-white font-black text-sm uppercase tracking-wider shadow-lg shadow-rose-600/30 transition-all active:scale-95 flex items-center justify-center gap-2"
                  >
                    <Mic className="w-5 h-5" />
                    <span>INICIAR GRAVAÇÃO AGORA</span>
                  </button>
                ) : (
                  <div className="space-y-3">
                    <button
                      onClick={finishRecording}
                      className="w-full py-4 px-6 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-sm uppercase tracking-wider shadow-xl shadow-emerald-600/30 transition-all active:scale-95 flex items-center justify-center gap-2"
                    >
                      <Check className="w-5 h-5" />
                      <span>FINALIZAR E GERAR RESUMO IA</span>
                    </button>

                    <div className="grid grid-cols-2 gap-3">
                      {isPaused ? (
                        <button
                          onClick={resumeRecording}
                          className="py-3 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs flex items-center justify-center gap-2"
                        >
                          <Play className="w-4 h-4 fill-white" />
                          <span>Continuar</span>
                        </button>
                      ) : (
                        <button
                          onClick={pauseRecording}
                          className="py-3 px-4 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs flex items-center justify-center gap-2"
                        >
                          <Pause className="w-4 h-4 fill-white" />
                          <span>Pausar</span>
                        </button>
                      )}

                      <button
                        onClick={cancelRecording}
                        className="py-3 px-4 rounded-xl bg-slate-900 hover:bg-rose-950 border border-slate-800 text-slate-300 hover:text-rose-300 font-bold text-xs flex items-center justify-center gap-2"
                      >
                        <X className="w-4 h-4" />
                        <span>Cancelar</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ================= ABA 2: RESUMO DA REUNIÃO SELECIONADA ================= */}
      {activeTab === "summary" && (
        <div className="space-y-6 animate-fadeIn">
          {/* Seletor de Reuniões Gravadas */}
          <div className="p-4 rounded-2xl glass-card border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 w-full max-w-full overflow-hidden">
            <div className="flex items-center gap-2">
              <History className="w-4 h-4 text-indigo-400 shrink-0" />
              <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
                Selecione a Reunião Gravada:
              </span>
            </div>

            {meetings.length === 0 ? (
              <p className="text-xs text-slate-500">Nenhuma reunião salva.</p>
            ) : (
              <select
                value={selectedMeeting?.meeting.id || ""}
                onChange={(e) => {
                  const found = meetings.find((m) => m.meeting.id === e.target.value);
                  if (found) setSelectedMeeting(found);
                }}
                className="px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-100 text-xs font-semibold focus:outline-none focus:border-indigo-500 max-w-full w-full sm:w-auto truncate"
              >
                {meetings.map((m) => (
                  <option key={m.meeting.id} value={m.meeting.id}>
                    {m.meeting.title} — ({new Date(m.meeting.meeting_date).toLocaleDateString("pt-BR")})
                  </option>
                ))}
              </select>
            )}
          </div>

          {!selectedMeeting ? (
            <div className="p-8 sm:p-16 rounded-3xl glass-card border border-slate-800 text-center space-y-4 w-full max-w-full overflow-hidden">
              <FileText className="w-14 h-14 text-slate-600 mx-auto" />
              <div className="space-y-1">
                <h3 className="text-base font-bold text-slate-200">Nenhuma reunião selecionada</h3>
                <p className="text-xs text-slate-400">Grave uma reunião ao vivo para gerar o resumo com IA.</p>
              </div>
              <button
                onClick={() => setActiveTab("record")}
                className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-lg shadow-indigo-600/30"
              >
                GRAVAR REUNIÃO AGORA
              </button>
            </div>
          ) : (
            <div className="space-y-6 w-full max-w-full overflow-hidden">
              {/* Header da Reunião Selecionada */}
              <div className="p-4 sm:p-6 rounded-3xl glass-card border border-indigo-500/20 flex flex-col md:flex-row md:items-center justify-between gap-4 w-full max-w-full overflow-hidden">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-0.5 rounded text-[10px] font-bold uppercase bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                      {selectedMeeting.meeting.status}
                    </span>
                    <span className="text-xs text-slate-400">
                      {new Date(selectedMeeting.meeting.meeting_date).toLocaleDateString("pt-BR", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    {selectedMeeting.meeting.duration_seconds && (
                      <span className="text-xs font-mono text-indigo-400 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                        ⏱️ {Math.floor(selectedMeeting.meeting.duration_seconds / 60)}m {selectedMeeting.meeting.duration_seconds % 60}s
                      </span>
                    )}
                  </div>

                  {isEditingTitle ? (
                    <div className="flex items-center gap-2 pt-1">
                      <input
                        type="text"
                        value={editingTitleValue}
                        onChange={(e) => setEditingTitleValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleSaveMeetingTitle();
                          if (e.key === "Escape") setIsEditingTitle(false);
                        }}
                        className="px-3 py-1.5 rounded-xl bg-slate-900 border border-indigo-500 text-white text-base font-bold focus:outline-none w-full"
                        autoFocus
                      />
                      <button
                        onClick={handleSaveMeetingTitle}
                        className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs flex items-center gap-1 shrink-0"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setIsEditingTitle(false)}
                        className="p-1.5 rounded-xl bg-slate-800 text-slate-400 hover:text-white text-xs shrink-0"
                        title="Cancelar"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <h2 className="text-xl font-black text-white">{selectedMeeting.meeting.title}</h2>
                      <button
                        onClick={() => {
                          setEditingTitleValue(selectedMeeting.meeting.title);
                          setIsEditingTitle(true);
                        }}
                        className="p-1 text-slate-400 hover:text-indigo-400 transition-colors"
                        title="Renomear Reunião"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                    </div>
                  )}

                  {selectedMeeting.meeting.description && (
                    <p className="text-xs text-slate-400">{selectedMeeting.meeting.description}</p>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => {
                      setEditingTitleValue(selectedMeeting.meeting.title);
                      setIsEditingTitle(true);
                    }}
                    className="px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-800 hover:border-indigo-500/40 text-slate-200 font-semibold text-xs flex items-center gap-1.5 transition-all"
                    title="Renomear Reunião"
                  >
                    <Edit2 className="w-4 h-4 text-indigo-400" />
                    <span>Renomear</span>
                  </button>

                  <button
                    onClick={copySummaryText}
                    className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs flex items-center gap-1.5 shadow-md shadow-indigo-600/20 transition-all active:scale-95"
                  >
                    <Copy className="w-4 h-4" />
                    <span>Copiar Resumo</span>
                  </button>

                  <button
                    onClick={() => setActiveTab("transcript")}
                    className="px-4 py-2 rounded-xl bg-slate-900 border border-slate-800 hover:border-indigo-500/40 text-slate-200 font-semibold text-xs flex items-center gap-1.5 transition-all"
                  >
                    <FileText className="w-4 h-4 text-indigo-400" />
                    <span>Ver Transcrição</span>
                  </button>
                </div>
              </div>

              {/* Player Integrado */}
              <MediaPlayer seekToTime={seekTime} />

              {/* Card 1: Resumo Executivo */}
              <div className="p-4 sm:p-6 rounded-3xl glass-card border border-indigo-500/20 space-y-3 w-full max-w-full overflow-hidden">
                <div className="flex items-center gap-2 text-indigo-400 font-bold text-sm">
                  <Sparkles className="w-4 h-4" />
                  <h3 className="uppercase tracking-wider">Resumo Executivo</h3>
                </div>
                <p className="text-sm text-slate-200 leading-relaxed break-words">
                  <strong className="text-white">Objetivo: </strong>
                  {selectedMeeting.summary?.objective || "Não especificado."}
                </p>
                <p className="text-sm text-slate-300 leading-relaxed break-words">
                  <strong className="text-white">Conclusão: </strong>
                  {selectedMeeting.summary?.conclusions || "Sem conclusões registradas."}
                </p>

                {selectedMeeting.summary?.key_topics && (
                  <div className="pt-2">
                    <span className="text-xs font-semibold text-slate-400 block mb-1">Principais Tópicos Discutidos:</span>
                    <ul className="list-disc list-inside text-xs text-slate-300 space-y-1">
                      {selectedMeeting.summary.key_topics.map((topic, i) => (
                        <li key={i} className="break-words">{topic}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* Grid 2 Colunas: Decisões Tomadas & Pontos Importantes */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6 w-full max-w-full">
                {/* Decisões Tomadas */}
                <div className="p-4 sm:p-6 rounded-3xl glass-card border border-emerald-500/20 space-y-4 w-full max-w-full overflow-hidden">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-2">
                      <Award className="w-4 h-4 shrink-0" />
                      <span>Decisões Tomadas</span>
                    </h3>
                    <span className="text-xs font-bold px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
                      {selectedMeeting.decisions.length}
                    </span>
                  </div>

                  {selectedMeeting.decisions.length === 0 ? (
                    <p className="text-xs text-slate-400">Nenhuma decisão registrada.</p>
                  ) : (
                    <div className="space-y-2.5">
                      {selectedMeeting.decisions.map((d) => (
                        <div key={d.id} className="p-3.5 rounded-2xl bg-slate-900/80 border border-emerald-500/20 space-y-1">
                          <p className="text-xs font-semibold text-slate-100 break-words">• {d.decision_text}</p>
                          {d.timestamp_start !== undefined && (
                            <button
                              onClick={() => {
                                setSeekTime(d.timestamp_start ?? null);
                                showToast(`Reproduzindo a partir de ${formatTimestamp(d.timestamp_start)}`);
                              }}
                              className="text-[10px] font-mono text-indigo-400 hover:underline flex items-center gap-1"
                            >
                              <Clock className="w-3 h-3" />
                              <span>Fonte: {formatTimestamp(d.timestamp_start)}</span>
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Pontos Importantes (Highlights) */}
                <div className="p-4 sm:p-6 rounded-3xl glass-card border border-purple-500/20 space-y-4 w-full max-w-full overflow-hidden">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold uppercase tracking-wider text-purple-400 flex items-center gap-2">
                      <Sparkles className="w-4 h-4 shrink-0" />
                      <span>Pontos Importantes</span>
                    </h3>
                    <span className="text-xs font-bold px-2 py-0.5 rounded bg-purple-500/20 text-purple-300">
                      {selectedMeeting.highlights.length}
                    </span>
                  </div>

                  {selectedMeeting.highlights.length === 0 ? (
                    <p className="text-xs text-slate-400">Nenhum ponto registrado.</p>
                  ) : (
                    <div className="space-y-2.5">
                      {selectedMeeting.highlights.map((h) => (
                        <div key={h.id} className="p-3.5 rounded-2xl bg-slate-900/80 border border-purple-500/20 space-y-1">
                          <p className="text-xs text-slate-200 break-words">{h.description}</p>
                          {h.timestamp_start !== undefined && (
                            <button
                              onClick={() => setSeekTime(h.timestamp_start ?? null)}
                              className="text-[10px] font-mono text-indigo-400 hover:underline flex items-center gap-1"
                            >
                              <Clock className="w-3 h-3" />
                              <span>Trecho: {formatTimestamp(h.timestamp_start)}</span>
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Card 3: Tarefas Mapeadas */}
              <div className="p-4 sm:p-6 rounded-3xl glass-card border border-slate-800 space-y-4 w-full max-w-full overflow-hidden">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-amber-400 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>Tarefas Mapeadas</span>
                  </h3>
                  <span className="text-xs font-bold px-2 py-0.5 rounded bg-amber-500/20 text-amber-300">
                    {selectedMeeting.tasks.length}
                  </span>
                </div>

                {selectedMeeting.tasks.length === 0 ? (
                  <p className="text-xs text-slate-400">Nenhuma tarefa atribuída nesta reunião.</p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {selectedMeeting.tasks.map((task) => (
                      <div key={task.id} className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="font-bold text-slate-100 text-xs break-words">{task.title}</h4>
                          <span className="px-2 py-0.5 rounded text-[9px] font-bold uppercase bg-amber-500/20 text-amber-300 shrink-0">
                            {task.priority}
                          </span>
                        </div>

                        <div className="text-[11px] text-slate-400 space-y-1">
                          <p>
                            <strong className="text-slate-300">Responsável: </strong>
                            <span className={task.assignee.includes("não definido") ? "text-amber-400 italic" : "text-indigo-300 font-semibold"}>
                              {task.assignee}
                            </span>
                          </p>
                          <p>
                            <strong className="text-slate-300">Prazo: </strong>
                            <span className={task.original_due_date_text?.includes("não definido") ? "text-amber-400 italic" : "text-slate-200"}>
                              {task.original_due_date_text}
                            </span>
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Grid 3 Colunas: Pendências, Riscos & Oportunidades */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6 w-full max-w-full">
                {/* Pendências */}
                <div className="p-4 sm:p-6 rounded-3xl glass-card border border-slate-800 space-y-3 w-full max-w-full overflow-hidden">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-rose-400">Pendências</h3>
                  {selectedMeeting.pending_items.length === 0 ? (
                    <p className="text-xs text-slate-400">Sem pendências abertas.</p>
                  ) : (
                    <ul className="space-y-2 text-xs text-slate-300">
                      {selectedMeeting.pending_items.map((p) => (
                        <li key={p.id} className="p-2.5 rounded-xl bg-slate-900/60 border border-rose-500/20 break-words">
                          • {p.item_text}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Riscos */}
                <div className="p-4 sm:p-6 rounded-3xl glass-card border border-slate-800 space-y-3 w-full max-w-full overflow-hidden">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-amber-400">Riscos e Alertas</h3>
                  {selectedMeeting.risks.length === 0 ? (
                    <p className="text-xs text-slate-400">Nenhum risco detectado.</p>
                  ) : (
                    <div className="space-y-2 text-xs">
                      {selectedMeeting.risks.map((r) => (
                        <div key={r.id} className="p-2.5 rounded-xl bg-slate-900/60 border border-amber-500/20 space-y-1">
                          <p className="text-slate-200 break-words">{r.description}</p>
                          {r.is_ai_generated && (
                            <span className="text-[9px] font-semibold text-indigo-400 block">
                              Identificado pela IA
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Oportunidades */}
                <div className="p-4 sm:p-6 rounded-3xl glass-card border border-slate-800 space-y-3 w-full max-w-full overflow-hidden">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-400">Oportunidades</h3>
                  {selectedMeeting.opportunities.length === 0 ? (
                    <p className="text-xs text-slate-400">Nenhuma oportunidade listada.</p>
                  ) : (
                    <div className="space-y-2 text-xs">
                      {selectedMeeting.opportunities.map((op) => (
                        <div key={op.id} className="p-2.5 rounded-xl bg-slate-900/60 border border-emerald-500/20">
                          <span className="text-[9px] font-bold uppercase text-emerald-400 block mb-0.5">{op.category}</span>
                          <p className="text-slate-200 break-words">{op.description}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Valores Monetários Mencionados */}
              {selectedMeeting.values && selectedMeeting.values.length > 0 && (
                <div className="p-4 sm:p-6 rounded-3xl glass-card border border-slate-800 space-y-3 w-full max-w-full overflow-hidden">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-indigo-400 flex items-center gap-1.5">
                    <DollarSign className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>Valores Monetários Mencionados</span>
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                    {selectedMeeting.values.map((val) => (
                      <div key={val.id} className="p-3 rounded-2xl bg-slate-900/80 border border-indigo-500/20">
                        <span className="text-base font-black text-emerald-400">{val.amount_formatted}</span>
                        <p className="text-xs text-slate-300 mt-1 break-words">{val.context}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ================= ABA 3: TRANSCRIÇÃO COMPLETA & PARTICIPANTES ================= */}
      {activeTab === "transcript" && selectedMeeting && (
        <div className="space-y-6 animate-fadeIn">
          {/* Painel de Participantes & Busca */}
          <div className="p-4 sm:p-6 rounded-3xl glass-card border border-slate-800 space-y-4 w-full max-w-full overflow-hidden">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                <input
                  type="text"
                  placeholder="Pesquisar fala ou trecho na transcrição..."
                  value={transcriptSearch}
                  onChange={(e) => setTranscriptSearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-100 text-sm focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="flex items-center gap-2">
                <UserCheck className="w-4 h-4 text-indigo-400 shrink-0" />
                <span className="text-xs font-semibold text-slate-300">Mapeamento de Fala:</span>
              </div>
            </div>

            {/* Editar Nomes dos Participantes */}
            <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-800/80">
              {Object.entries(selectedMeeting.transcript?.speaker_map || {}).map(([oldKey, currentName]) => (
                <div key={oldKey} className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-xs">
                  {editingSpeaker === oldKey ? (
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={newSpeakerName}
                        onChange={(e) => setNewSpeakerName(e.target.value)}
                        placeholder={currentName}
                        className="px-2 py-0.5 rounded bg-slate-950 text-white text-xs border border-indigo-500 focus:outline-none"
                      />
                      <button
                        onClick={() => handleSaveSpeakerName(oldKey)}
                        className="px-2 py-0.5 rounded bg-indigo-600 text-white font-bold text-[10px]"
                      >
                        Salvar
                      </button>
                    </div>
                  ) : (
                    <>
                      <span className="text-slate-400 font-mono text-[10px]">{oldKey} →</span>
                      <span className="font-bold text-indigo-300">{currentName}</span>
                      <button
                        onClick={() => {
                          setEditingSpeaker(oldKey);
                          setNewSpeakerName(currentName);
                        }}
                        className="p-1 text-slate-500 hover:text-white"
                        title="Editar Nome do Participante"
                      >
                        <Edit2 className="w-3 h-3" />
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Diálogo por Trechos */}
          <div className="p-4 sm:p-6 rounded-3xl glass-card border border-slate-800 space-y-4 w-full max-w-full overflow-hidden">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
              Linha do Tempo do Diálogo ({filteredSegments.length} trechos)
            </h3>

            <div className="space-y-4 divide-y divide-slate-800/60">
              {filteredSegments.map((seg) => (
                <div key={seg.id} className="pt-4 first:pt-0 space-y-1.5 group">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        onClick={() => setSeekTime(seg.start_time)}
                        className="px-2.5 py-0.5 rounded bg-indigo-600/20 hover:bg-indigo-600 text-indigo-300 hover:text-white font-mono text-xs font-bold transition-all border border-indigo-500/30 shrink-0"
                        title="Reproduzir áudio deste trecho"
                      >
                        {formatTimestamp(seg.start_time)}
                      </button>
                      <span className="font-bold text-slate-200 text-xs">
                        {selectedMeeting.transcript?.speaker_map[seg.speaker] || seg.speaker}
                      </span>
                    </div>

                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(`"${seg.text}" (${seg.speaker})`);
                        showToast("Trecho copiado!");
                      }}
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-slate-500 hover:text-white text-xs flex items-center gap-1 shrink-0"
                    >
                      <Copy className="w-3 h-3" />
                      <span>Copiar</span>
                    </button>
                  </div>

                  <p className="text-sm text-slate-300 leading-relaxed font-sans pl-2 border-l-2 border-slate-800 group-hover:border-indigo-500 transition-colors break-words">
                    {seg.text}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
