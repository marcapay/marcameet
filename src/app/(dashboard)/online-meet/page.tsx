"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Radio,
  Mic,
  Play,
  Pause,
  Square,
  Check,
  AlertTriangle,
  Clock,
  ArrowLeft,
  Copy,
  FileText,
  Volume2,
  VolumeX,
  Sparkles,
  ShieldAlert,
  Share2,
  Monitor,
  Video,
  CheckCircle2,
  ChevronDown,
  RefreshCw
} from "lucide-react";
import { saveLocalMeeting } from "@/lib/storage/mockStorage";
import { processAudioTranscription, hasConfiguredApiKey } from "@/lib/ai";
import { CompleteMeetingDetails } from "@/types/database";

export type OnlineMeetingStatus =
  | "Aguardando início"
  | "Solicitando compartilhamento"
  | "Capturando áudio"
  | "Transcrevendo"
  | "Pausado"
  | "Finalizado"
  | "Erro de captura"
  | "Áudio interrompido";

interface LiveSegment {
  id: string;
  timestamp: string;
  start_time: number;
  speaker: string;
  text: string;
}

export default function OnlineMeetingPage() {
  const router = useRouter();

  // Estados de Fluxo & Configuração
  const [step, setStep] = useState<"setup" | "recording" | "finished">("setup");
  const [meetingTitle, setMeetingTitle] = useState("Reunião Comercial Interlagos");
  const [platform, setPlatform] = useState<"Google Meet" | "Zoom" | "Microsoft Teams" | "Outra">("Google Meet");
  const [privacyConfirmed, setPrivacyConfirmed] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Estados de Execução da Reunião
  const [meetingStatus, setMeetingStatus] = useState<OnlineMeetingStatus>("Aguardando início");
  const [seconds, setSeconds] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [segments, setSegments] = useState<LiveSegment[]>([]);
  const [speakerMap, setSpeakerMap] = useState<Record<string, string>>({
    "Participante 1": "Participante 1",
    "Participante 2": "Participante 2",
  });

  // Rolagem Automática Inteligente
  const [isAutoScrollEnabled, setIsAutoScrollEnabled] = useState(true);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Refs de Processamento de Áudio e Cronômetro
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number>(0);
  const accumulatedTimeRef = useRef<number>(0);
  const transcriptContainerRef = useRef<HTMLDivElement | null>(null);

  const meetingIdRef = useRef<string>(`m-online-${Date.now()}`);
  const isChunkProcessingRef = useRef<boolean>(false);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // Cronômetro da Reunião
  useEffect(() => {
    if (step === "recording" && !isPaused && meetingStatus === "Capturando áudio") {
      timerIntervalRef.current = setInterval(() => {
        if (startTimeRef.current > 0) {
          const now = Date.now();
          const totalMs = accumulatedTimeRef.current + (now - startTimeRef.current);
          setSeconds(Math.floor(totalMs / 1000));
        }
      }, 500);

      return () => {
        if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      };
    } else {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    }
  }, [step, isPaused, meetingStatus]);

  // Rolagem Automática ao receber novas falas
  useEffect(() => {
    if (isAutoScrollEnabled && transcriptContainerRef.current) {
      transcriptContainerRef.current.scrollTop = transcriptContainerRef.current.scrollHeight;
    }
  }, [segments, isAutoScrollEnabled]);

  const formatTimer = (totalSec: number) => {
    const hrs = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    if (hrs > 0) {
      return `${hrs.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
    }
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const formatTimestamp = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  // Tratar Rolagem do Usuário na Caixa de Transcrição
  const handleScroll = () => {
    if (!transcriptContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = transcriptContainerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 40;
    setIsAutoScrollEnabled(isAtBottom);
  };

  // Etapa 2: Iniciar Captura da Reunião via getDisplayMedia
  const startCapture = async () => {
    if (!meetingTitle.trim()) {
      alert("Por favor, digite o nome da reunião.");
      return;
    }

    if (!privacyConfirmed) {
      alert("Você precisa confirmar que está autorizado a realizar a transcrição da reunião.");
      return;
    }

    if (!hasConfiguredApiKey()) {
      alert("⚠️ Nenhuma API Key configurada! Acesse as Configurações e insira sua chave de API antes de iniciar.");
      return;
    }

    setErrorMessage(null);
    setMeetingStatus("Solicitando compartilhamento");

    try {
      // Solicitar compartilhamento da aba/janela do navegador com áudio
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });

      const audioTracks = displayStream.getAudioTracks();

      if (audioTracks.length === 0) {
        setMeetingStatus("Erro de captura");
        setErrorMessage(
          "Nenhuma faixa de áudio foi selecionada. Certifique-se de marcar a caixa 'Compartilhar áudio' ao selecionar a aba no navegador."
        );
        displayStream.getTracks().forEach((track) => track.stop());
        return;
      }

      // Criar um stream contendo estritamente as faixas de áudio
      const audioOnlyStream = new MediaStream(audioTracks);
      mediaStreamRef.current = displayStream;

      // Monitorar interrupção do compartilhamento pela barra do navegador
      const primaryAudioTrack = audioTracks[0];
      primaryAudioTrack.onended = () => {
        handleAudioInterrupted();
      };

      // Configurar MediaRecorder para fatiar o áudio em blocos contínuos de 8 segundos
      let mimeType = "audio/webm;codecs=opus";
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = "audio/webm";
      }
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = "audio/ogg";
      }

      const recorder = new MediaRecorder(audioOnlyStream, { mimeType });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = async (event) => {
        if (event.data && event.data.size > 0) {
          await processAudioChunk(event.data);
        }
      };

      // Iniciar gravação com fatiamento a cada 8 segundos (8000ms)
      recorder.start(8000);

      startTimeRef.current = Date.now();
      accumulatedTimeRef.current = 0;
      setSeconds(0);
      setStep("recording");
      setMeetingStatus("Capturando áudio");
    } catch (err: any) {
      console.error("Erro ao solicitar getDisplayMedia:", err);
      setMeetingStatus("Erro de captura");
      if (err.name === "NotAllowedError") {
        setErrorMessage("Compartilhamento cancelado pelo usuário.");
      } else {
        setErrorMessage(`Falha na captura: ${err.message || "Permissão negada ou navegador incompatível."}`);
      }
    }
  };

  // Etapa 3: Processar Bloco de Áudio em Tempo Real
  const processAudioChunk = async (blob: Blob) => {
    if (blob.size < 1000 || isChunkProcessingRef.current) return;

    try {
      isChunkProcessingRef.current = true;
      setMeetingStatus("Transcrevendo");

      const chunkFilename = `online_chunk_${Date.now()}.webm`;
      const transcriptionResult = await processAudioTranscription(blob, chunkFilename);

      if (transcriptionResult && transcriptionResult.segments && transcriptionResult.segments.length > 0) {
        const currentSec = Math.max(0, seconds - 8);

        const newLiveSegments: LiveSegment[] = transcriptionResult.segments.map((seg, idx) => ({
          id: `seg-online-${Date.now()}-${idx}`,
          timestamp: formatTimestamp(currentSec + Math.floor(seg.start_time || 0)),
          start_time: currentSec + Math.floor(seg.start_time || 0),
          speaker: seg.speaker || "Participante 1",
          text: seg.text,
        }));

        setSegments((prev) => [...prev, ...newLiveSegments]);

        if (transcriptionResult.speaker_map) {
          setSpeakerMap((prev) => ({ ...prev, ...transcriptionResult.speaker_map }));
        }
      }
    } catch (err) {
      console.warn("Erro temporário na transcrição do bloco de áudio:", err);
    } finally {
      isChunkProcessingRef.current = false;
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
        setMeetingStatus("Capturando áudio");
      }
    }
  };

  // Tratamento quando o compartilhamento de áudio é interrompido no navegador
  const handleAudioInterrupted = () => {
    setMeetingStatus("Áudio interrompido");
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      try {
        mediaRecorderRef.current.stop();
      } catch (e) {}
    }
    if (startTimeRef.current > 0) {
      accumulatedTimeRef.current += Date.now() - startTimeRef.current;
      startTimeRef.current = 0;
    }
    showToast("O compartilhamento de áudio foi interrompido.");
  };

  // Controles: Pausar Transcrição
  const pauseTranscription = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.pause();
      if (startTimeRef.current > 0) {
        accumulatedTimeRef.current += Date.now() - startTimeRef.current;
        startTimeRef.current = 0;
      }
      setIsPaused(true);
      setMeetingStatus("Pausado");
    }
  };

  // Controles: Continuar Transcrição
  const resumeTranscription = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "paused") {
      mediaRecorderRef.current.resume();
      startTimeRef.current = Date.now();
      setIsPaused(false);
      setMeetingStatus("Capturando áudio");
    }
  };

  // Etapa 5: Finalizar Reunião & Salvar Dados Sem Resumo IA
  const finishMeeting = async () => {
    if (confirm("Deseja encerrar a captura e finalizar a reunião online?")) {
      setMeetingStatus("Finalizado");

      if (startTimeRef.current > 0) {
        accumulatedTimeRef.current += Date.now() - startTimeRef.current;
        startTimeRef.current = 0;
      }
      const finalDuration = Math.max(1, Math.floor(accumulatedTimeRef.current / 1000));
      setSeconds(finalDuration);

      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        try {
          mediaRecorderRef.current.stop();
        } catch (e) {}
      }

      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      }

      const meetingId = meetingIdRef.current;
      const fullRawText = segments.map((s) => `[${s.timestamp}] ${s.speaker}: ${s.text}`).join("\n");

      const completeDetails: CompleteMeetingDetails = {
        meeting: {
          id: meetingId,
          user_id: "u-001",
          title: meetingTitle.trim(),
          description: `Transcrição de reunião online (${platform}) capturada via navegador.`,
          meeting_date: new Date().toISOString(),
          duration_seconds: finalDuration,
          source_type: "online_meeting",
          status: "CONCLUIDA",
          error_message: null,
          tags: ["Reunião Online", platform],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        transcript: {
          id: `t-${meetingId}`,
          meeting_id: meetingId,
          raw_text: fullRawText,
          speaker_map: speakerMap,
          segments: segments.map((s) => ({
            id: s.id,
            transcript_id: `t-${meetingId}`,
            meeting_id: meetingId,
            start_time: s.start_time,
            end_time: s.start_time + 5,
            speaker: s.speaker,
            text: s.text,
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

      // Salvar reunião no localStorage e Supabase (sem gerar resumo automático)
      saveLocalMeeting(completeDetails);

      setStep("finished");
      showToast("Reunião finalizada e transcrição salva no histórico!");
    }
  };

  const copyFullTranscript = () => {
    const text = segments.map((s) => `[${s.timestamp}] ${s.speaker}: ${s.text}`).join("\n");
    navigator.clipboard.writeText(text);
    showToast("Transcrição completa copiada!");
  };

  return (
    <div className="space-y-6 animate-fadeIn pb-12">
      {/* Toast Notification Floating */}
      {toastMessage && (
        <div className="fixed top-20 right-6 z-50 p-4 rounded-2xl bg-emerald-600 text-white font-bold text-xs shadow-2xl flex items-center gap-2 animate-bounce">
          <Check className="w-4 h-4" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Header com botão Voltar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push("/meetings")}
            className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded text-[10px] font-bold uppercase bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 flex items-center gap-1">
                <Radio className="w-3 h-3 text-emerald-400 animate-pulse" />
                <span>MÓDULO REUNIÃO ONLINE</span>
              </span>
            </div>
            <h1 className="text-xl md:text-2xl font-black text-white">Transcrição de Reunião Online</h1>
          </div>
        </div>
      </div>

      {/* ================= PASSO 1: CONFIGURAÇÃO DA REUNIÃO ================= */}
      {step === "setup" && (
        <div className="p-8 rounded-3xl glass-card border border-slate-800 space-y-6 max-w-3xl mx-auto shadow-2xl">
          <div className="border-b border-slate-800/80 pb-4">
            <h2 className="text-lg font-black text-white flex items-center gap-2">
              <Monitor className="w-5 h-5 text-indigo-400" />
              <span>Configurar Captura da Reunião</span>
            </h2>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">
              Capture e transcreva áudio em tempo real de reuniões do Google Meet, Zoom, Microsoft Teams ou abas do navegador.
            </p>
          </div>

          {errorMessage && (
            <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2.5">
              <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          <div className="space-y-4">
            {/* Nome da Reunião */}
            <div className="space-y-1.5">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-300">
                Nome da Reunião <span className="text-rose-400">*</span>
              </label>
              <input
                type="text"
                placeholder="Ex: Reunião Comercial Interlagos"
                value={meetingTitle}
                onChange={(e) => setMeetingTitle(e.target.value)}
                className="w-full px-4 py-3 rounded-2xl bg-slate-900 border border-slate-800 text-white text-sm focus:outline-none focus:border-indigo-500 transition-colors"
              />
            </div>

            {/* Seleção de Plataforma */}
            <div className="space-y-1.5">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-300">
                Plataforma de Transmissão (Opcional)
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {(["Google Meet", "Zoom", "Microsoft Teams", "Outra"] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPlatform(p)}
                    className={`py-2.5 px-3 rounded-xl font-semibold text-xs border transition-all flex items-center justify-center gap-1.5 ${
                      platform === p
                        ? "bg-indigo-600 text-white border-indigo-500 shadow-md shadow-indigo-600/30"
                        : "bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800"
                    }`}
                  >
                    <Video className="w-3.5 h-3.5" />
                    <span>{p}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Aviso de Privacidade & Termos */}
            <div className="p-4 rounded-2xl bg-slate-900/90 border border-indigo-500/20 space-y-3 pt-4">
              <div className="flex items-center gap-2 text-indigo-400 font-bold text-xs">
                <ShieldAlert className="w-4 h-4" />
                <span className="uppercase tracking-wider">Aviso de Privacidade & Consentimento</span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                Certifique-se de que os participantes estão cientes da transcrição da reunião antes de iniciar a captura.
              </p>

              <label className="flex items-center gap-3 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={privacyConfirmed}
                  onChange={(e) => setPrivacyConfirmed(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-700 bg-slate-950 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                />
                <span className="text-xs font-semibold text-slate-200">
                  Confirmo que estou autorizado a realizar a transcrição desta reunião.
                </span>
              </label>
            </div>
          </div>

          {/* Botão de Ação */}
          <div className="pt-2">
            <button
              onClick={startCapture}
              disabled={!privacyConfirmed || !meetingTitle.trim()}
              className="w-full py-4 px-6 rounded-2xl bg-gradient-to-r from-emerald-600 to-indigo-600 hover:from-emerald-500 hover:to-indigo-500 disabled:opacity-50 text-white font-black text-sm uppercase tracking-wider shadow-xl shadow-emerald-600/20 transition-all active:scale-95 flex items-center justify-center gap-2"
            >
              <Radio className="w-5 h-5 text-emerald-300 animate-pulse" />
              <span>INICIAR CAPTURA DA REUNIÃO</span>
            </button>
          </div>
        </div>
      )}

      {/* ================= PASSO 2: INTERFACE DE TRANSCRIÇÃO AO VIVO ================= */}
      {(step === "recording" || step === "finished") && (
        <div className="space-y-6">
          {/* Painel de Status & Cronômetro */}
          <div className="p-6 rounded-3xl glass-card border border-indigo-500/20 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-xl">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                {/* Badge de Status */}
                <span
                  className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider border flex items-center gap-1.5 ${
                    meetingStatus === "Capturando áudio" || meetingStatus === "Transcrevendo"
                      ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40 animate-pulse"
                      : meetingStatus === "Pausado"
                      ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                      : meetingStatus === "Áudio interrompido" || meetingStatus === "Erro de captura"
                      ? "bg-rose-500/20 text-rose-300 border-rose-500/40"
                      : "bg-indigo-500/20 text-indigo-300 border-indigo-500/40"
                  }`}
                >
                  <span className="w-2 h-2 rounded-full bg-current"></span>
                  <span>{meetingStatus}</span>
                </span>

                <span className="text-xs font-semibold px-2.5 py-0.5 rounded bg-slate-900 text-slate-300 border border-slate-800">
                  {platform}
                </span>

                <span className="text-xs font-mono text-indigo-400 bg-slate-900 px-2.5 py-0.5 rounded border border-slate-800 flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" />
                  <span>{formatTimer(seconds)}</span>
                </span>
              </div>

              <h2 className="text-2xl font-black text-white pt-1">{meetingTitle}</h2>
            </div>

            {/* Botões de Ação na Reunião */}
            <div className="flex flex-wrap items-center gap-2">
              {step === "recording" && (
                <>
                  {isPaused ? (
                    <button
                      onClick={resumeTranscription}
                      className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs flex items-center gap-2 shadow-lg shadow-indigo-600/30 transition-all active:scale-95"
                    >
                      <Play className="w-4 h-4 fill-white" />
                      <span>Continuar Transcrição</span>
                    </button>
                  ) : (
                    <button
                      onClick={pauseTranscription}
                      className="px-4 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs flex items-center gap-2 shadow-lg shadow-amber-600/30 transition-all active:scale-95"
                    >
                      <Pause className="w-4 h-4 fill-white" />
                      <span>Pausar Transcrição</span>
                    </button>
                  )}

                  <button
                    onClick={finishMeeting}
                    className="px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs flex items-center gap-2 shadow-lg shadow-rose-600/30 transition-all active:scale-95"
                  >
                    <Square className="w-4 h-4 fill-white" />
                    <span>Finalizar Reunião</span>
                  </button>
                </>
              )}

              {step === "finished" && (
                <button
                  onClick={copyFullTranscript}
                  className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-2 shadow-lg shadow-emerald-600/30 transition-all active:scale-95"
                >
                  <Copy className="w-4 h-4" />
                  <span>Copiar Transcrição</span>
                </button>
              )}
            </div>
          </div>

          {/* Aviso de Áudio Interrompido */}
          {meetingStatus === "Áudio interrompido" && (
            <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 shrink-0 text-amber-400" />
                <span>O compartilhamento de áudio foi interrompido. Toda a transcrição realizada foi salva com sucesso.</span>
              </div>
              <button
                onClick={finishMeeting}
                className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs shrink-0"
              >
                Concluir Reunião
              </button>
            </div>
          )}

          {/* Container de Transcrição Contínua com Auto-Scroll */}
          <div className="p-6 rounded-3xl glass-card border border-slate-800 space-y-4 relative">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-indigo-400" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                  Transcrição Contínua em Tempo Real ({segments.length} trechos)
                </h3>
              </div>

              <button
                onClick={copyFullTranscript}
                disabled={segments.length === 0}
                className="text-xs font-semibold text-indigo-400 hover:underline flex items-center gap-1 disabled:opacity-50"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>Copiar Texto</span>
              </button>
            </div>

            {/* Área de Fala com Rolagem */}
            <div
              ref={transcriptContainerRef}
              onScroll={handleScroll}
              className="h-[420px] overflow-y-auto pr-2 space-y-4 divide-y divide-slate-800/60 custom-scrollbar"
            >
              {segments.length === 0 ? (
                <div className="py-20 text-center space-y-3">
                  <div className="w-12 h-12 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center mx-auto animate-pulse">
                    <Mic className="w-6 h-6 text-indigo-400" />
                  </div>
                  <p className="text-sm font-semibold text-slate-300">
                    Aguardando falas da reunião...
                  </p>
                  <p className="text-xs text-slate-500 max-w-sm mx-auto">
                    O áudio capturado é fatiado e transcrevido em tempo real. As frases aparecerão aqui progressivamente.
                  </p>
                </div>
              ) : (
                segments.map((seg) => (
                  <div key={seg.id} className="pt-4 first:pt-0 space-y-1 group">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded bg-indigo-600/20 text-indigo-300 font-mono text-[11px] font-bold border border-indigo-500/30">
                        {seg.timestamp}
                      </span>
                      <span className="font-bold text-slate-200 text-xs">
                        {speakerMap[seg.speaker] || seg.speaker}:
                      </span>
                    </div>

                    <p className="text-sm text-slate-200 leading-relaxed font-sans pl-2 border-l-2 border-indigo-500/50 group-hover:border-indigo-400 transition-colors">
                      {seg.text}
                    </p>
                  </div>
                ))
              )}
            </div>

            {/* Botão Flutuante para voltar ao final quando o usuário rolar para cima */}
            {!isAutoScrollEnabled && (
              <button
                onClick={() => {
                  setIsAutoScrollEnabled(true);
                  if (transcriptContainerRef.current) {
                    transcriptContainerRef.current.scrollTop = transcriptContainerRef.current.scrollHeight;
                  }
                }}
                className="absolute bottom-6 right-6 px-3.5 py-2 rounded-xl bg-indigo-600 text-white font-bold text-xs shadow-2xl flex items-center gap-1.5 animate-bounce hover:bg-indigo-500 transition-all"
              >
                <ChevronDown className="w-4 h-4" />
                <span>Rolar para o final</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
