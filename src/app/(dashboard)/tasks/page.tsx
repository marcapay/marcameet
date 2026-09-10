"use client";

import { useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  FileText,
  Sparkles,
  Award,
  CheckCircle2,
  Clock,
  Copy,
  Check,
  Search,
  UserCheck,
  Edit2,
  DollarSign,
  Mic,
  History,
  ArrowRight,
  TrendingUp,
  AlertTriangle,
  Trash2
} from "lucide-react";
import { getLocalMeetings, updateSpeakerNameInMeeting, deleteLocalMeeting } from "@/lib/storage/mockStorage";
import { CompleteMeetingDetails } from "@/types/database";
import { MediaPlayer } from "@/components/audio/MediaPlayer";

function TasksContent() {
  const searchParams = useSearchParams();
  const meetingIdParam = searchParams?.get("meetingId");

  const [meetings, setMeetings] = useState<CompleteMeetingDetails[]>([]);
  const [selectedMeeting, setSelectedMeeting] = useState<CompleteMeetingDetails | null>(null);

  // Transcrição & Player
  const [seekTime, setSeekTime] = useState<number | null>(null);
  const [transcriptSearch, setTranscriptSearch] = useState("");
  const [editingSpeaker, setEditingSpeaker] = useState<string | null>(null);
  const [newSpeakerName, setNewSpeakerName] = useState("");
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const reloadMeetings = () => {
    const list = getLocalMeetings();
    setMeetings(list);
    if (list.length > 0) {
      if (meetingIdParam) {
        const foundParam = list.find((m) => m.meeting.id === meetingIdParam);
        if (foundParam) {
          setSelectedMeeting(foundParam);
          return;
        }
      }
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
  }, [meetingIdParam]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleDeleteMeeting = (meetingId: string, title: string) => {
    if (confirm(`Tem certeza que deseja excluir a reunião "${title}"?`)) {
      deleteLocalMeeting(meetingId);
      reloadMeetings();
      showToast("Reunião excluída com sucesso!");
    }
  };

  const formatTimestamp = (sec?: number) => {
    if (sec === undefined || sec === null) return null;
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

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
    showToast("Resumo copiado com sucesso!");
  };

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

  const filteredSegments = (selectedMeeting?.transcript?.segments || []).filter(
    (seg) =>
      seg.text.toLowerCase().includes(transcriptSearch.toLowerCase()) ||
      seg.speaker.toLowerCase().includes(transcriptSearch.toLowerCase())
  );

  return (
    <div className="space-y-6 animate-fadeIn pb-12">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-20 right-6 z-50 p-4 rounded-2xl bg-emerald-600 text-white font-bold text-xs shadow-2xl flex items-center gap-2 animate-bounce">
          <Check className="w-4 h-4" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Header Principal da Página */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-white flex items-center gap-2">
            <FileText className="w-6 h-6 text-indigo-400" />
            <span>Resumos das Reuniões</span>
          </h1>
          <p className="text-xs text-slate-400">
            Inteligência executiva, decisões e tarefas extraídas com IA das suas gravações.
          </p>
        </div>

        <Link
          href="/record"
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-rose-600 to-indigo-600 hover:from-rose-500 hover:to-indigo-500 text-white font-bold text-xs shadow-lg shadow-rose-600/20 transition-all active:scale-95"
        >
          <Mic className="w-4 h-4" />
          <span>GRAVAR NOVA REUNIÃO</span>
        </Link>
      </div>

      {/* Seletor de Reuniões Gravadas */}
      <div className="p-4 rounded-2xl glass-card border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-indigo-400" />
          <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
            Selecione a Reunião para Visualizar o Resumo:
          </span>
        </div>

        {meetings.length === 0 ? (
          <p className="text-xs text-slate-500">Nenhuma reunião registrada.</p>
        ) : (
          <select
            value={selectedMeeting?.meeting.id || ""}
            onChange={(e) => {
              const found = meetings.find((m) => m.meeting.id === e.target.value);
              if (found) setSelectedMeeting(found);
            }}
            className="px-4 py-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-100 text-xs font-semibold focus:outline-none focus:border-indigo-500 max-w-md w-full sm:w-auto"
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
        <div className="p-16 rounded-3xl glass-card border border-slate-800 text-center space-y-4">
          <FileText className="w-14 h-14 text-slate-600 mx-auto" />
          <div className="space-y-1">
            <h3 className="text-base font-bold text-slate-200">Nenhum resumo disponível</h3>
            <p className="text-xs text-slate-400">
              Grave uma nova reunião ao vivo para gerar o resumo executivo e tarefas com inteligência artificial.
            </p>
          </div>
          <Link
            href="/record"
            className="inline-block px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-lg shadow-indigo-600/30 transition-all active:scale-95"
          >
            GRAVAR REUNIÃO AGORA
          </Link>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Header da Reunião Selecionada */}
          <div className="p-6 rounded-3xl glass-card border border-indigo-500/20 flex flex-col md:flex-row md:items-center justify-between gap-4">
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
              <h2 className="text-xl font-black text-white">{selectedMeeting.meeting.title}</h2>
              {selectedMeeting.meeting.description && (
                <p className="text-xs text-slate-400">{selectedMeeting.meeting.description}</p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={copySummaryText}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs flex items-center gap-1.5 shadow-md shadow-indigo-600/20 transition-all active:scale-95"
              >
                <Copy className="w-4 h-4" />
                <span>Copiar Resumo</span>
              </button>

              <button
                onClick={() => handleDeleteMeeting(selectedMeeting.meeting.id, selectedMeeting.meeting.title)}
                className="px-3.5 py-2 rounded-xl bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 font-semibold text-xs flex items-center gap-1.5 transition-all"
                title="Excluir Reunião"
              >
                <Trash2 className="w-4 h-4" />
                <span>Excluir</span>
              </button>

              <Link
                href={`/meetings/${selectedMeeting.meeting.id}`}
                className="px-4 py-2 rounded-xl bg-slate-900 border border-slate-800 hover:border-indigo-500/40 text-slate-200 font-semibold text-xs flex items-center gap-1.5 transition-all"
              >
                <ArrowRight className="w-4 h-4 text-indigo-400" />
                <span>Ver Detalhes</span>
              </Link>
            </div>
          </div>

          {/* Player Integrado */}
          <MediaPlayer seekToTime={seekTime} />

          {/* Card 1: Resumo Executivo Gerado por IA */}
          <div className="p-6 rounded-3xl glass-card border border-indigo-500/20 space-y-3">
            <div className="flex items-center gap-2 text-indigo-400 font-bold text-sm">
              <Sparkles className="w-4 h-4" />
              <h3 className="uppercase tracking-wider">Resumo Executivo Gerado por IA</h3>
            </div>
            <p className="text-sm text-slate-200 leading-relaxed">
              <strong className="text-white">Objetivo: </strong>
              {selectedMeeting.summary?.objective || "Não especificado."}
            </p>
            <p className="text-sm text-slate-300 leading-relaxed">
              <strong className="text-white">Conclusão: </strong>
              {selectedMeeting.summary?.conclusions || "Sem conclusões registradas."}
            </p>

            {selectedMeeting.summary?.key_topics && (
              <div className="pt-2">
                <span className="text-xs font-semibold text-slate-400 block mb-1">Principais Tópicos Discutidos:</span>
                <ul className="list-disc list-inside text-xs text-slate-300 space-y-1">
                  {selectedMeeting.summary.key_topics.map((topic, i) => (
                    <li key={i}>{topic}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Grid 2 Colunas: Decisões Tomadas & Pontos Importantes */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Decisões Tomadas */}
            <div className="p-6 rounded-3xl glass-card border border-emerald-500/20 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-2">
                  <Award className="w-4 h-4" />
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
                      <p className="text-xs font-semibold text-slate-100">• {d.decision_text}</p>
                      {d.timestamp_start !== undefined && (
                        <button
                          onClick={() => setSeekTime(d.timestamp_start ?? null)}
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

            {/* Pontos Importantes */}
            <div className="p-6 rounded-3xl glass-card border border-purple-500/20 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold uppercase tracking-wider text-purple-400 flex items-center gap-2">
                  <Sparkles className="w-4 h-4" />
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
                      <p className="text-xs text-slate-200">{h.description}</p>
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

          {/* Tarefas Mapeadas por IA */}
          <div className="p-6 rounded-3xl glass-card border border-slate-800 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold uppercase tracking-wider text-amber-400 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" />
                <span>Tarefas Mapeadas por IA</span>
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
                      <h4 className="font-bold text-slate-100 text-xs">{task.title}</h4>
                      <span className="px-2 py-0.5 rounded text-[9px] font-bold uppercase bg-amber-500/20 text-amber-300">
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
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="p-6 rounded-3xl glass-card border border-slate-800 space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-rose-400">Pendências</h3>
              {selectedMeeting.pending_items.length === 0 ? (
                <p className="text-xs text-slate-400">Sem pendências abertas.</p>
              ) : (
                <ul className="space-y-2 text-xs text-slate-300">
                  {selectedMeeting.pending_items.map((p) => (
                    <li key={p.id} className="p-2.5 rounded-xl bg-slate-900/60 border border-rose-500/20">
                      • {p.item_text}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="p-6 rounded-3xl glass-card border border-slate-800 space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-amber-400">Riscos e Alertas</h3>
              {selectedMeeting.risks.length === 0 ? (
                <p className="text-xs text-slate-400">Nenhum risco detectado.</p>
              ) : (
                <div className="space-y-2 text-xs">
                  {selectedMeeting.risks.map((r) => (
                    <div key={r.id} className="p-2.5 rounded-xl bg-slate-900/60 border border-amber-500/20 space-y-1">
                      <p className="text-slate-200">{r.description}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="p-6 rounded-3xl glass-card border border-slate-800 space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-400">Oportunidades</h3>
              {selectedMeeting.opportunities.length === 0 ? (
                <p className="text-xs text-slate-400">Nenhuma oportunidade listada.</p>
              ) : (
                <div className="space-y-2 text-xs">
                  {selectedMeeting.opportunities.map((op) => (
                    <div key={op.id} className="p-2.5 rounded-xl bg-slate-900/60 border border-emerald-500/20">
                      <span className="text-[9px] font-bold uppercase text-emerald-400 block mb-0.5">{op.category}</span>
                      <p className="text-slate-200">{op.description}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Transcrição Completa */}
          <div className="p-6 rounded-3xl glass-card border border-slate-800 space-y-4">
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
                <UserCheck className="w-4 h-4 text-indigo-400" />
                <span className="text-xs font-semibold text-slate-300">Mapeamento de Fala:</span>
              </div>
            </div>

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

            <div className="space-y-4 divide-y divide-slate-800/60 pt-2">
              {filteredSegments.map((seg) => (
                <div key={seg.id} className="pt-4 first:pt-0 space-y-1.5 group">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setSeekTime(seg.start_time)}
                        className="px-2.5 py-0.5 rounded bg-indigo-600/20 hover:bg-indigo-600 text-indigo-300 hover:text-white font-mono text-xs font-bold transition-all border border-indigo-500/30"
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
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-slate-500 hover:text-white text-xs flex items-center gap-1"
                    >
                      <Copy className="w-3 h-3" />
                      <span>Copiar</span>
                    </button>
                  </div>

                  <p className="text-sm text-slate-300 leading-relaxed font-sans pl-2 border-l-2 border-slate-800 group-hover:border-indigo-500 transition-colors">
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

export default function TasksPage() {
  return (
    <Suspense fallback={<div className="p-12 text-center text-slate-400 text-xs">Carregando resumos...</div>}>
      <TasksContent />
    </Suspense>
  );
}
