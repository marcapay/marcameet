"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, FileAudio, FileVideo, CheckCircle2, Sparkles, AlertCircle, ArrowRight } from "lucide-react";
import { saveLocalMeeting } from "@/lib/storage/mockStorage";
import { processAudioTranscription, processAIAnalysis } from "@/lib/ai";
import { CompleteMeetingDetails } from "@/types/database";

export default function UploadPage() {
  const router = useRouter();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState("");

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setSelectedFile(file);
      if (!title) {
        // Sugerir título baseado no nome do arquivo
        const nameWithoutExt = file.name.replace(/\.[^/.]+$/, "");
        setTitle(nameWithoutExt.replace(/[-_]/g, " "));
      }
    }
  };

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) return;

    setIsProcessing(true);
    setUploadProgress(10);
    setStatusMessage("Enviando arquivo para o servidor...");

    const isVideo = selectedFile.type.startsWith("video/") || selectedFile.name.endsWith(".mp4") || selectedFile.name.endsWith(".webm");
    const sourceType = isVideo ? ("video_upload" as const) : ("audio_upload" as const);
    const newMeetingId = `m-${Date.now()}`;
    const meetingTitle = title.trim() || selectedFile.name;

    // 1. Criar registro inicial
    const initialDetails: CompleteMeetingDetails = {
      meeting: {
        id: newMeetingId,
        user_id: "u-001",
        title: meetingTitle,
        description: `Arquivo de ${isVideo ? "vídeo" : "áudio"}: ${selectedFile.name}`,
        meeting_date: new Date().toISOString(),
        duration_seconds: 0,
        source_type: sourceType,
        status: "TRANSCREVENDO",
        error_message: null,
        tags: [isVideo ? "Vídeo" : "Áudio", "Upload"],
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
      setUploadProgress(40);
      setStatusMessage("Executando transcrição por inteligência de voz...");
      const transcriptData = await processAudioTranscription(selectedFile, selectedFile.name);

      setUploadProgress(75);
      setStatusMessage("Extraindo tarefas, decisões e resumo executivo...");
      const aiData = await processAIAnalysis(transcriptData.raw_text, transcriptData.segments);

      setUploadProgress(100);

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
      router.push(`/meetings/${newMeetingId}`);
    } catch (err) {
      console.error("Erro no processamento:", err);
      initialDetails.meeting.status = "ERRO";
      initialDetails.meeting.error_message = "Falha no envio ou transcrição do arquivo.";
      saveLocalMeeting(initialDetails);
      router.push(`/meetings/${newMeetingId}`);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-fadeIn">
      <div>
        <h1 className="text-2xl font-black text-white flex items-center gap-2">
          <Upload className="w-6 h-6 text-indigo-400" />
          <span>Enviar Áudio ou Vídeo</span>
        </h1>
        <p className="text-xs text-slate-400">
          Suporta MP3, WAV, M4A, MP4, WebM e gravações do Google Meet, Zoom ou Teams.
        </p>
      </div>

      <form onSubmit={handleUploadSubmit} className="space-y-6">
        {/* Dropzone / Upload Box */}
        <div className="p-8 rounded-3xl glass-card border-2 border-dashed border-slate-700 hover:border-indigo-500/50 text-center space-y-4 transition-colors relative">
          <input
            type="file"
            accept="audio/*,video/*,.mp3,.wav,.m4a,.mp4,.webm"
            onChange={handleFileChange}
            disabled={isProcessing}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          />

          {!selectedFile ? (
            <div className="space-y-3">
              <div className="w-16 h-16 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center mx-auto text-indigo-400">
                <Upload className="w-8 h-8" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-bold text-slate-200">
                  Clique ou arraste seu arquivo aqui
                </p>
                <p className="text-xs text-slate-400">
                  Selecione da galeria, arquivos do dispositivo ou computador
                </p>
              </div>
              <div className="flex items-center justify-center gap-2 text-[10px] text-slate-500 pt-2">
                <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800">MP3</span>
                <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800">WAV</span>
                <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800">M4A</span>
                <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800">MP4</span>
                <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800">WebM</span>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between p-4 rounded-2xl bg-slate-900/80 border border-indigo-500/30 text-left">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-600/30 border border-indigo-500/40 flex items-center justify-center text-indigo-300">
                  {selectedFile.type.startsWith("video") ? <FileVideo className="w-5 h-5" /> : <FileAudio className="w-5 h-5" />}
                </div>
                <div>
                  <p className="text-sm font-bold text-white line-clamp-1">{selectedFile.name}</p>
                  <p className="text-xs text-slate-400">{formatFileSize(selectedFile.size)}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedFile(null)}
                className="text-xs font-semibold text-rose-400 hover:underline"
              >
                Trocar
              </button>
            </div>
          )}
        </div>

        {/* Form Meta fields */}
        {selectedFile && (
          <div className="p-6 rounded-3xl glass-card border border-slate-800 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Título da Reunião</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ex: Gravação Google Meet - Alinhamento Semanal"
                className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-100 text-sm focus:outline-none focus:border-indigo-500"
              />
            </div>

            {/* Progress status */}
            {isProcessing && (
              <div className="space-y-2 pt-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-indigo-300">{statusMessage}</span>
                  <span className="font-bold text-white">{uploadProgress}%</span>
                </div>
                <div className="w-full h-2 rounded-full bg-slate-900 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all duration-300"
                    style={{ width: `${uploadProgress}%` }}
                  ></div>
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={isProcessing}
              className="w-full py-4 px-6 rounded-2xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-extrabold text-sm shadow-lg shadow-indigo-600/30 flex items-center justify-center gap-2 transition-all active:scale-95"
            >
              {isProcessing ? (
                <>
                  <Sparkles className="w-5 h-5 animate-spin" />
                  <span>PROCESSANDO COM IA...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-5 h-5" />
                  <span>ENVIAR E ANALISAR REUNIÃO</span>
                </>
              )}
            </button>
          </div>
        )}
      </form>
    </div>
  );
}
