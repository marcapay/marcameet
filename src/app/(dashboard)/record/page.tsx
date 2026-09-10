"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Mic, Square, Pause, Play, X, Check, Sparkles, AlertCircle, FileText, Tag, Calendar, KeyRound, AlertTriangle } from "lucide-react";
import { saveLocalMeeting } from "@/lib/storage/mockStorage";
import { processAudioTranscription, processAIAnalysis, hasConfiguredApiKey } from "@/lib/ai";
import { requestScreenWakeLock, releaseScreenWakeLock, startAudioKeepAlive, stopAudioKeepAlive } from "@/lib/audio/recordingKeepAlive";
import { CompleteMeetingDetails } from "@/types/database";

export default function RecordPage() {
  const router = useRouter();

  // Campos Opcionais Antes da Gravação
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tagsInput, setTagsInput] = useState("Presencial, Alinhamento");

  // Estado da Gravação
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [processingStatus, setProcessingStatus] = useState<string | null>(null);

  // Verificação da API Key Obrigatória
  const [apiKeyMissing, setApiKeyMissing] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number>(0);
  const accumulatedTimeRef = useRef<number>(0);

  useEffect(() => {
    setApiKeyMissing(!hasConfiguredApiKey());
  }, []);

  // Atualizar cronômetro em tempo real baseado em Date.now()
  const updateTimer = () => {
    if (startTimeRef.current > 0) {
      const now = Date.now();
      const totalMs = accumulatedTimeRef.current + (now - startTimeRef.current);
      setSeconds(Math.floor(totalMs / 1000));
    }
  };

  // Controle de Cronômetro com sincronização em tempo real e reativação em tela ativa (visibilitychange)
  useEffect(() => {
    if (isRecording && !isPaused) {
      timerRef.current = setInterval(() => {
        updateTimer();
      }, 500);

      const handleVisibilityChange = () => {
        if (document.visibilityState === "visible") {
          updateTimer();
          requestScreenWakeLock();
        }
      };

      document.addEventListener("visibilitychange", handleVisibilityChange);

      return () => {
        if (timerRef.current) clearInterval(timerRef.current);
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      };
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
  }, [isRecording, isPaused]);

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

  // Iniciar Gravação
  const startRecording = async () => {
    if (!hasConfiguredApiKey()) {
      alert("⚠️ Nenhuma API Key cadastrada! Acesse as Configurações e insira sua chave de API para utilizar a gravação.");
      router.push("/settings");
      return;
    }

    try {
      await requestScreenWakeLock();
      startAudioKeepAlive();

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];

      let mimeType = "audio/webm;codecs=opus";
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = "audio/ogg";
      }

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      stream.getAudioTracks().forEach((track) => {
        track.onended = () => {
          console.warn("Entrada de áudio encerrada pelo sistema.");
        };
      });

      recorder.start(1000);

      startTimeRef.current = Date.now();
      accumulatedTimeRef.current = 0;

      setIsRecording(true);
      setIsPaused(false);
      setSeconds(0);
    } catch (err) {
      console.error("Erro ao acessar microfone:", err);
      alert("Não foi possível acessar o microfone. Verifique as permissões do seu navegador.");
      releaseScreenWakeLock();
      stopAudioKeepAlive();
    }
  };

  // Pausar Gravação
  const pauseRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.pause();
      if (startTimeRef.current > 0) {
        accumulatedTimeRef.current += Date.now() - startTimeRef.current;
        startTimeRef.current = 0;
      }
      setIsPaused(true);
    }
  };

  // Continuar Gravação
  const resumeRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.resume();
      startTimeRef.current = Date.now();
      setIsPaused(false);
      requestScreenWakeLock();
    }
  };

  // Cancelar Gravação
  const cancelRecording = () => {
    if (confirm("Deseja realmente cancelar a gravação? O áudio atual será descartado.")) {
      if (mediaRecorderRef.current) {
        mediaRecorderRef.current.stop();
        mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop());
      }
      setIsRecording(false);
      setIsPaused(false);
      setSeconds(0);
      startTimeRef.current = 0;
      accumulatedTimeRef.current = 0;
      audioChunksRef.current = [];
      releaseScreenWakeLock();
      stopAudioKeepAlive();
    }
  };

  // Finalizar e Processar
  const finishRecording = async () => {
    if (!mediaRecorderRef.current) return;

    if (startTimeRef.current > 0) {
      accumulatedTimeRef.current += Date.now() - startTimeRef.current;
      startTimeRef.current = 0;
    }
    const duration = Math.max(1, Math.floor(accumulatedTimeRef.current / 1000));
    setSeconds(duration);

    // 1. Parar gravação e capturar áudio original
    setProcessingStatus("Salvando arquivo original de áudio...");
    mediaRecorderRef.current.stop();
    mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop());

    releaseScreenWakeLock();
    stopAudioKeepAlive();

    const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
    const meetingTitle = title.trim() || `Reunião Presencial - ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;

    const newMeetingId = `m-${Date.now()}`;
    const tagsArray = tagsInput.split(",").map((t) => t.trim()).filter(Boolean);

    // Salvar Estrutura Inicial Imediatamente (Zero perda de dados)
    const initialDetails: CompleteMeetingDetails = {
      meeting: {
        id: newMeetingId,
        user_id: "u-001",
        title: meetingTitle,
        description: description || "Gravação presencial iniciada pelo celular/computador.",
        meeting_date: new Date().toISOString(),
        duration_seconds: duration,
        source_type: "recording",
        status: "TRANSCREVENDO",
        error_message: null,
        tags: tagsArray,
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

    try {
      // 2. Iniciar Transcrição
      setProcessingStatus("Transcrevendo áudio com inteligência de fala da API Key...");
      const transcriptData = await processAudioTranscription(audioBlob, "gravacao_presencial.webm");

      // 3. Iniciar Análise por IA
      setProcessingStatus("Gerando resumo executivo detalhado, decisões e tarefas com IA...");
      const aiData = await processAIAnalysis(transcriptData.raw_text, transcriptData.segments);

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

      // Redirecionar DIRETO para a Aba de Resumos (/tasks) exibindo o resumo detalhado feito pela IA
      router.push(`/tasks?meetingId=${newMeetingId}`);
    } catch (e: any) {
      console.error("Erro durante o processamento por IA:", e);
      initialDetails.meeting.status = "ERRO";
      initialDetails.meeting.error_message = e.message || "Ocorreu um erro no processamento por IA.";
      saveLocalMeeting(initialDetails);
      router.push(`/tasks?meetingId=${newMeetingId}`);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-fadeIn">
      {/* Header da Tela */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-white flex items-center gap-2">
            <Mic className="w-6 h-6 text-rose-500" />
            <span>Gravação Presencial</span>
          </h1>
          <p className="text-xs text-slate-400">
            Grave conversas ao vivo pelo celular ou computador em alta qualidade.
          </p>
        </div>
        {isRecording && (
          <span className="px-3 py-1 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30 text-xs font-bold flex items-center gap-1.5 animate-pulse">
            <span className="w-2 h-2 rounded-full bg-rose-500"></span>
            Gravando ao vivo
          </span>
        )}
      </div>

      {/* Alerta de API Key Obrigatória Faltando */}
      {apiKeyMissing && (
        <div className="p-5 rounded-3xl bg-rose-950/60 border border-rose-500/40 text-slate-100 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-xl">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-6 h-6 text-rose-400 shrink-0" />
            <div>
              <h3 className="font-bold text-sm text-rose-200">API Key Obrigatória Faltando</h3>
              <p className="text-xs text-rose-300/80">
                O sistema exige o cadastro de uma Chave de API (OpenAI, Gemini ou Groq) para transcrever e analisar reuniões.
              </p>
            </div>
          </div>

          <Link
            href="/settings"
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
                className="w-full h-full rounded-full bg-slate-950 hover:bg-rose-600/20 flex items-center justify-center border border-rose-500/50 transition-all transform hover:scale-105 active:scale-95 group focus:outline-none"
              >
                <Mic className="w-10 h-10 text-rose-500 group-hover:text-white transition-colors" />
              </button>
            </div>

            <div className="space-y-2 max-w-md mx-auto">
              <button
                onClick={startRecording}
                className="w-full py-4 px-6 rounded-2xl bg-gradient-to-r from-rose-600 to-indigo-600 hover:from-rose-500 hover:to-indigo-500 text-white font-extrabold text-lg shadow-lg shadow-rose-600/25 transition-all transform hover:-translate-y-0.5 active:scale-95"
              >
                INICIAR GRAVAÇÃO
              </button>
              <p className="text-[11px] text-slate-400">
                Toque no botão para iniciar imediatamente a gravação da reunião presencial.
              </p>
            </div>
          </div>

          {/* Campos Opcionais Antes da Gravação */}
          <div className="p-6 rounded-3xl glass-card border border-slate-800 space-y-4">
            <div className="flex items-center gap-2 border-b border-slate-800/80 pb-3">
              <FileText className="w-4 h-4 text-indigo-400" />
              <h2 className="text-sm font-bold text-slate-200">Informações Opcionais</h2>
              <span className="text-[10px] text-slate-400 ml-auto">(Não obrigatório)</span>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Título da Reunião</label>
                <input
                  type="text"
                  placeholder="Ex: Reunião Alinhamento Estratégico Q3"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-100 text-sm focus:outline-none focus:border-indigo-500 transition-colors"
                />
              </div>

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
        <div className="p-8 rounded-3xl glass-card border border-rose-500/30 text-center space-y-8 shadow-2xl">
          {/* Cronômetro */}
          <div className="space-y-2">
            <span className="text-xs font-bold uppercase tracking-widest text-slate-400">Tempo Decorrido</span>
            <div className="text-5xl md:text-6xl font-black tracking-tight text-white font-mono">
              {formatTimer(seconds)}
            </div>
            {isPaused && (
              <span className="inline-block px-3 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-xs font-semibold">
                PAUSADO
              </span>
            )}
          </div>

          {/* Equalizador Visual de Gravação */}
          {!isPaused && (
            <div className="flex items-center justify-center gap-1.5 h-10 my-4">
              <div className="w-1.5 bg-rose-500 rounded-full animate-bar-1"></div>
              <div className="w-1.5 bg-rose-500 rounded-full animate-bar-2"></div>
              <div className="w-1.5 bg-indigo-500 rounded-full animate-bar-3"></div>
              <div className="w-1.5 bg-rose-500 rounded-full animate-bar-4"></div>
              <div className="w-1.5 bg-indigo-500 rounded-full animate-bar-5"></div>
            </div>
          )}

          {/* Controles: Pausar, Continuar, Finalizar, Cancelar */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 max-w-lg mx-auto">
            {isPaused ? (
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
              onClick={finishRecording}
              className="col-span-2 flex items-center justify-center gap-2 py-3 px-6 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-sm shadow-lg shadow-emerald-600/30 transition-all active:scale-95"
            >
              <Check className="w-5 h-5" />
              <span>FINALIZAR E GERAR RESUMO</span>
            </button>

            <button
              onClick={cancelRecording}
              className="flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-slate-900 hover:bg-rose-950 border border-slate-800 hover:border-rose-500/40 text-slate-300 hover:text-rose-300 font-semibold text-xs transition-all"
            >
              <X className="w-4 h-4" />
              <span>Cancelar</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
