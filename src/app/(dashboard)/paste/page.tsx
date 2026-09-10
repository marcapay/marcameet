"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Sparkles, CheckCircle2 } from "lucide-react";
import { saveLocalMeeting } from "@/lib/storage/mockStorage";
import { processAIAnalysis } from "@/lib/ai";
import { CompleteMeetingDetails } from "@/types/database";

export default function PastePage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [pastedText, setPastedText] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

  const handlePasteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pastedText.trim()) return;

    setIsProcessing(true);
    const newMeetingId = `m-${Date.now()}`;
    const meetingTitle = title.trim() || `Transcrição Colada - ${new Date().toLocaleDateString("pt-BR")}`;

    // 1. Registro inicial
    const initialDetails: CompleteMeetingDetails = {
      meeting: {
        id: newMeetingId,
        user_id: "u-001",
        title: meetingTitle,
        description: "Transcrição manual colada pelo usuário.",
        meeting_date: new Date().toISOString(),
        duration_seconds: 0,
        source_type: "pasted_text",
        status: "ANALISANDO",
        error_message: null,
        tags: ["Texto Colado", "Manual"],
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
      // 2. Análise direta sem etapa de transcrição de áudio
      const aiData = await processAIAnalysis(pastedText);

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
          raw_text: pastedText,
          speaker_map: { "Pessoa 1": "Pessoa 1", "Pessoa 2": "Pessoa 2" },
          segments: [
            {
              id: `seg-${newMeetingId}-0`,
              transcript_id: `t-${newMeetingId}`,
              meeting_id: newMeetingId,
              start_time: 0,
              end_time: 0,
              speaker: "Transcrição",
              text: pastedText,
            },
          ],
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
    } catch (e) {
      console.error("Erro ao analisar transcrição colada:", e);
      initialDetails.meeting.status = "ERRO";
      saveLocalMeeting(initialDetails);
      router.push(`/meetings/${newMeetingId}`);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-fadeIn">
      <div>
        <h1 className="text-2xl font-black text-white flex items-center gap-2">
          <FileText className="w-6 h-6 text-emerald-400" />
          <span>Colar Transcrição</span>
        </h1>
        <p className="text-xs text-slate-400">
          Cole uma transcrição já existente para extrair resumo, decisões, tarefas e riscos.
        </p>
      </div>

      <form onSubmit={handlePasteSubmit} className="space-y-6">
        <div className="p-6 rounded-3xl glass-card border border-slate-800 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">Título da Reunião</label>
            <input
              type="text"
              placeholder="Ex: Transcrição da Reunião de Alinhamento"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-100 text-sm focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">Texto Transcrito</label>
            <textarea
              rows={12}
              required
              placeholder="Cole aqui o texto da transcrição (Ex: Pessoa 1: Precisamos definir o orçamento...)"
              value={pastedText}
              onChange={(e) => setPastedText(e.target.value)}
              className="w-full p-4 rounded-2xl bg-slate-900 border border-slate-800 text-slate-100 text-sm focus:outline-none focus:border-indigo-500 font-mono resize-none leading-relaxed"
            />
          </div>

          <button
            type="submit"
            disabled={isProcessing || !pastedText.trim()}
            className="w-full py-4 px-6 rounded-2xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-extrabold text-sm shadow-lg shadow-emerald-600/30 flex items-center justify-center gap-2 transition-all active:scale-95"
          >
            {isProcessing ? (
              <>
                <Sparkles className="w-5 h-5 animate-spin" />
                <span>ANALISANDO COM IA...</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="w-5 h-5" />
                <span>EXECUTAR ANÁLISE DE IA</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
