"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  FileText,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  Award,
  Clock,
  DollarSign,
  Calendar,
  Quote,
  TrendingUp,
  Download,
  Copy,
  Edit2,
  Search,
  Check,
  ArrowLeft,
  Share2,
  UserCheck,
  Trash2,
  X
} from "lucide-react";
import { getLocalMeetings, updateSpeakerNameInMeeting, updateMeetingTitle, deleteLocalMeeting } from "@/lib/storage/mockStorage";
import { CompleteMeetingDetails } from "@/types/database";
import { MediaPlayer } from "@/components/audio/MediaPlayer";

export default function MeetingDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [details, setDetails] = useState<CompleteMeetingDetails | null>(null);
  const [activeTab, setActiveTab] = useState<"summary" | "transcript" | "export">("summary");
  
  // Transcrição & Player
  const [seekTime, setSeekTime] = useState<number | null>(null);
  const [transcriptSearch, setTranscriptSearch] = useState("");
  const [editingSpeaker, setEditingSpeaker] = useState<string | null>(null);
  const [newSpeakerName, setNewSpeakerName] = useState("");
  const [copiedNotification, setCopiedNotification] = useState<string | null>(null);

  // Edição de Título da Reunião
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [newTitle, setNewTitle] = useState("");

  const handleSaveTitle = () => {
    if (!newTitle.trim()) return;
    const updated = updateMeetingTitle(id, newTitle.trim());
    if (updated) {
      setDetails(updated);
      setCopiedNotification("Título da reunião atualizado!");
      setTimeout(() => setCopiedNotification(null), 2500);
    }
    setIsEditingTitle(false);
  };

  useEffect(() => {
    const list = getLocalMeetings();
    const found = list.find((m) => m.meeting.id === id);
    if (found) {
      setDetails(found);
    }
  }, [id]);

  if (!details) {
    return (
      <div className="p-12 text-center space-y-4">
        <Sparkles className="w-10 h-10 text-indigo-400 mx-auto animate-spin" />
        <p className="text-sm font-semibold text-slate-300">Carregando detalhes da reunião...</p>
      </div>
    );
  }

  const { meeting, summary, transcript, highlights, decisions, tasks, pending_items, risks, opportunities, values, dates, quotes, next_steps_agreed, next_steps_ai_suggestions } = details;

  // Atualizar Nome de Participante (Edição Global em toda a reunião - Req #8)
  const handleSaveSpeakerName = (oldSpeaker: string) => {
    if (!newSpeakerName.trim()) return;
    const updated = updateSpeakerNameInMeeting(id, oldSpeaker, newSpeakerName.trim());
    if (updated) {
      setDetails(updated);
    }
    setEditingSpeaker(null);
    setNewSpeakerName("");
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedNotification(label);
    setTimeout(() => setCopiedNotification(null), 2500);
  };

  const formatTimestamp = (sec?: number) => {
    if (sec === undefined || sec === null) return null;
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  // Transcrição Filtrada
  const filteredSegments = (transcript?.segments || []).filter((seg) =>
    seg.text.toLowerCase().includes(transcriptSearch.toLowerCase()) ||
    seg.speaker.toLowerCase().includes(transcriptSearch.toLowerCase())
  );

  return (
    <div className="space-y-6 animate-fadeIn pb-12">
      {/* Voltar & Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push("/meetings")}
            className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors shrink-0"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded text-[10px] font-bold uppercase bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                {meeting.status}
              </span>
              <span className="text-xs text-slate-400">
                {new Date(meeting.meeting_date).toLocaleDateString("pt-BR", {
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                })}
              </span>
            </div>

            {isEditingTitle ? (
              <div className="flex items-center gap-2 pt-1">
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSaveTitle();
                    if (e.key === "Escape") setIsEditingTitle(false);
                  }}
                  className="px-3 py-1.5 rounded-xl bg-slate-900 border border-indigo-500 text-white text-base md:text-lg font-bold focus:outline-none w-full max-w-md"
                  autoFocus
                />
                <button
                  onClick={handleSaveTitle}
                  className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs flex items-center gap-1 transition-all shrink-0"
                >
                  <Check className="w-4 h-4" />
                  <span>Salvar</span>
                </button>
                <button
                  onClick={() => setIsEditingTitle(false)}
                  className="p-1.5 rounded-xl bg-slate-800 text-slate-400 hover:text-white text-xs transition-all shrink-0"
                  title="Cancelar"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2.5">
                <h1 className="text-xl md:text-2xl font-black text-white">{meeting.title}</h1>
                <button
                  onClick={() => {
                    setNewTitle(meeting.title);
                    setIsEditingTitle(true);
                  }}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-400 hover:bg-slate-800/60 transition-colors"
                  title="Renomear Reunião"
                >
                  <Edit2 className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Ações da Reunião */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setNewTitle(meeting.title);
              setIsEditingTitle(true);
            }}
            className="px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-800 hover:border-indigo-500/40 text-slate-200 font-semibold text-xs flex items-center gap-2 transition-all"
            title="Renomear Reunião"
          >
            <Edit2 className="w-4 h-4 text-indigo-400" />
            <span>Renomear</span>
          </button>

          <button
            onClick={() =>
              copyToClipboard(
                `RESUMO REUNIÃO: ${meeting.title}\n\nObjetivo: ${summary?.objective}\n\nConclusões: ${summary?.conclusions}`,
                "Resumo copiado!"
              )
            }
            className="px-4 py-2 rounded-xl bg-slate-900 border border-slate-800 hover:border-indigo-500/40 text-slate-200 font-semibold text-xs flex items-center gap-2 transition-all"
          >
            <Copy className="w-4 h-4 text-indigo-400" />
            <span>Copiar Resumo</span>
          </button>

          <button
            onClick={() => {
              if (confirm(`Tem certeza que deseja excluir a reunião "${meeting.title}"?`)) {
                deleteLocalMeeting(meeting.id);
                router.push("/meetings");
              }
            }}
            className="px-3.5 py-2 rounded-xl bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 font-semibold text-xs flex items-center gap-1.5 transition-all"
            title="Excluir Reunião"
          >
            <Trash2 className="w-4 h-4" />
            <span>Excluir</span>
          </button>
        </div>
      </div>

      {/* Toast Notification */}
      {copiedNotification && (
        <div className="fixed top-20 right-6 z-50 px-4 py-2.5 rounded-xl bg-emerald-600 text-white font-bold text-xs shadow-2xl flex items-center gap-2 animate-bounce">
          <Check className="w-4 h-4" />
          <span>{copiedNotification}</span>
        </div>
      )}

      {/* Player Integrado */}
      <MediaPlayer seekToTime={seekTime} />

      {/* Abas Principais */}
      <div className="flex items-center border-b border-slate-800 gap-2">
        <button
          onClick={() => setActiveTab("summary")}
          className={`py-3 px-5 text-sm font-bold border-b-2 transition-all flex items-center gap-2 ${
            activeTab === "summary"
              ? "border-indigo-500 text-indigo-400"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          <Sparkles className="w-4 h-4" />
          <span>Análise com IA</span>
        </button>

        <button
          onClick={() => setActiveTab("transcript")}
          className={`py-3 px-5 text-sm font-bold border-b-2 transition-all flex items-center gap-2 ${
            activeTab === "transcript"
              ? "border-indigo-500 text-indigo-400"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          <FileText className="w-4 h-4" />
          <span>Transcrição Completa</span>
        </button>

        <button
          onClick={() => setActiveTab("export")}
          className={`py-3 px-5 text-sm font-bold border-b-2 transition-all flex items-center gap-2 ${
            activeTab === "export"
              ? "border-indigo-500 text-indigo-400"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          <Download className="w-4 h-4" />
          <span>Exportação</span>
        </button>
      </div>

      {/* TAB 1: VISÃO GERAL E ANÁLISE POR IA */}
      {activeTab === "summary" && (
        <div className="space-y-6">
          {/* Resumo Executivo */}
          <div className="p-6 rounded-3xl glass-card border border-indigo-500/20 space-y-3">
            <div className="flex items-center gap-2 text-indigo-400 font-bold text-sm">
              <Sparkles className="w-4 h-4" />
              <h2 className="uppercase tracking-wider">Resumo Executivo</h2>
            </div>
            <p className="text-sm text-slate-200 leading-relaxed">
              <strong className="text-white">Objetivo: </strong> {summary?.objective || "Não especificado."}
            </p>
            <p className="text-sm text-slate-300 leading-relaxed">
              <strong className="text-white">Conclusão: </strong> {summary?.conclusions || "Sem conclusões registradas."}
            </p>

            {summary?.key_topics && (
              <div className="pt-2">
                <span className="text-xs font-semibold text-slate-400 block mb-1">Principais Assuntos Discutidos:</span>
                <ul className="list-disc list-inside text-xs text-slate-300 space-y-1">
                  {summary.key_topics.map((topic, i) => (
                    <li key={i}>{topic}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Grid de 2 Colunas para Decisões & Pontos Importantes */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Decisões Tomadas */}
            <div className="p-6 rounded-3xl glass-card border border-emerald-500/20 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-2">
                  <Award className="w-4 h-4" />
                  <span>Decisões Tomadas</span>
                </h2>
                <span className="text-xs font-bold px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
                  {decisions.length}
                </span>
              </div>

              {decisions.length === 0 ? (
                <p className="text-xs text-slate-400">Nenhuma decisão confirmada nesta reunião.</p>
              ) : (
                <div className="space-y-3">
                  {decisions.map((d) => (
                    <div key={d.id} className="p-3.5 rounded-2xl bg-slate-900/80 border border-emerald-500/20 space-y-1.5">
                      <p className="text-xs font-semibold text-slate-100">{d.decision_text}</p>
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
                <h2 className="text-sm font-bold uppercase tracking-wider text-purple-400 flex items-center gap-2">
                  <Sparkles className="w-4 h-4" />
                  <span>Pontos Importantes</span>
                </h2>
                <span className="text-xs font-bold px-2 py-0.5 rounded bg-purple-500/20 text-purple-300">
                  {highlights.length}
                </span>
              </div>

              {highlights.length === 0 ? (
                <p className="text-xs text-slate-400">Nenhum ponto registrado.</p>
              ) : (
                <div className="space-y-3">
                  {highlights.map((h) => (
                    <div key={h.id} className="p-3.5 rounded-2xl bg-slate-900/80 border border-purple-500/20 space-y-1.5">
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

          {/* Tarefas Mapeadas */}
          <div className="p-6 rounded-3xl glass-card border border-slate-800 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold uppercase tracking-wider text-amber-400 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" />
                <span>Tarefas Mapeadas</span>
              </h2>
              <span className="text-xs font-bold px-2 py-0.5 rounded bg-amber-500/20 text-amber-300">
                {tasks.length}
              </span>
            </div>

            {tasks.length === 0 ? (
              <p className="text-xs text-slate-400">Nenhuma tarefa identificada.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {tasks.map((task) => (
                  <div key={task.id} className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-bold text-slate-100 text-xs">{task.title}</h3>
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

                    {task.timestamp_start !== undefined && (
                      <button
                        onClick={() => setSeekTime(task.timestamp_start ?? null)}
                        className="text-[10px] font-mono text-indigo-400 hover:underline flex items-center gap-1 pt-1"
                      >
                        <Clock className="w-3 h-3" />
                        <span>Ver origem ({formatTimestamp(task.timestamp_start)})</span>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Pendências, Riscos & Oportunidades (Grid de 3 Colunas) */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Pendências */}
            <div className="p-6 rounded-3xl glass-card border border-slate-800 space-y-3">
              <h2 className="text-xs font-bold uppercase tracking-wider text-rose-400">Pendências</h2>
              {pending_items.length === 0 ? (
                <p className="text-xs text-slate-400">Sem pendências abertas.</p>
              ) : (
                <ul className="space-y-2 text-xs text-slate-300">
                  {pending_items.map((p) => (
                    <li key={p.id} className="p-2.5 rounded-xl bg-slate-900/60 border border-rose-500/20">
                      • {p.item_text}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Riscos e Alertas */}
            <div className="p-6 rounded-3xl glass-card border border-slate-800 space-y-3">
              <h2 className="text-xs font-bold uppercase tracking-wider text-amber-400">Riscos e Alertas</h2>
              {risks.length === 0 ? (
                <p className="text-xs text-slate-400">Nenhum risco detectado.</p>
              ) : (
                <div className="space-y-2 text-xs">
                  {risks.map((r) => (
                    <div key={r.id} className="p-2.5 rounded-xl bg-slate-900/60 border border-amber-500/20 space-y-1">
                      <p className="text-slate-200">{r.description}</p>
                      {r.is_ai_generated && (
                        <span className="text-[9px] font-semibold text-indigo-400 block">
                          Risco identificado pela IA
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Oportunidades */}
            <div className="p-6 rounded-3xl glass-card border border-slate-800 space-y-3">
              <h2 className="text-xs font-bold uppercase tracking-wider text-emerald-400">Oportunidades</h2>
              {opportunities.length === 0 ? (
                <p className="text-xs text-slate-400">Nenhuma oportunidade listada.</p>
              ) : (
                <div className="space-y-2 text-xs">
                  {opportunities.map((op) => (
                    <div key={op.id} className="p-2.5 rounded-xl bg-slate-900/60 border border-emerald-500/20">
                      <span className="text-[9px] font-bold uppercase text-emerald-400 block mb-0.5">{op.category}</span>
                      <p className="text-slate-200">{op.description}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Valores Monetários */}
          {values.length > 0 && (
            <div className="p-6 rounded-3xl glass-card border border-slate-800 space-y-3">
              <h2 className="text-xs font-bold uppercase tracking-wider text-indigo-400 flex items-center gap-1.5">
                <DollarSign className="w-4 h-4 text-emerald-400" />
                <span>Valores Monetários Mencionados</span>
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                {values.map((val) => (
                  <div key={val.id} className="p-3 rounded-2xl bg-slate-900/80 border border-indigo-500/20">
                    <span className="text-base font-black text-emerald-400">{val.amount_formatted}</span>
                    <p className="text-xs text-slate-300 mt-1">{val.context}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: TRANSCRIÇÃO COMPLETA & EDIÇÃO DE NOMES */}
      {activeTab === "transcript" && (
        <div className="space-y-6">
          {/* Busca na Transcrição & Mapeamento de Participantes */}
          <div className="p-6 rounded-3xl glass-card border border-slate-800 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                <input
                  type="text"
                  placeholder="Pesquisar palavra ou trecho na transcrição..."
                  value={transcriptSearch}
                  onChange={(e) => setTranscriptSearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-100 text-sm focus:outline-none focus:border-indigo-500"
                />
              </div>

              {/* Lista de Participantes Identificados */}
              <div className="flex items-center gap-2">
                <UserCheck className="w-4 h-4 text-indigo-400" />
                <span className="text-xs font-semibold text-slate-300">Participantes:</span>
              </div>
            </div>

            {/* Painel de Substituição de Falantes */}
            <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-800/80">
              {Object.entries(transcript?.speaker_map || {}).map(([oldKey, currentName]) => (
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

          {/* Segmentos de Texto com Timestamps Clicáveis */}
          <div className="p-6 rounded-3xl glass-card border border-slate-800 space-y-4">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
              Linha do Tempo de Diálogo ({filteredSegments.length} trechos)
            </h2>

            <div className="space-y-4 divide-y divide-slate-800/60">
              {filteredSegments.map((seg) => (
                <div key={seg.id} className="pt-4 first:pt-0 space-y-1.5 group">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setSeekTime(seg.start_time)}
                        className="px-2 py-0.5 rounded bg-indigo-600/20 hover:bg-indigo-600 text-indigo-300 hover:text-white font-mono text-xs font-bold transition-all border border-indigo-500/30"
                        title="Tocar áudio deste trecho"
                      >
                        {formatTimestamp(seg.start_time)}
                      </button>
                      <span className="font-bold text-slate-200 text-xs">
                        {transcript?.speaker_map[seg.speaker] || seg.speaker}
                      </span>
                    </div>

                    <button
                      onClick={() => copyToClipboard(`"${seg.text}" (${seg.speaker})`, "Trecho copiado!")}
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

      {/* TAB 3: EXPORTAÇÃO */}
      {activeTab === "export" && (
        <div className="p-8 rounded-3xl glass-card border border-slate-800 space-y-6">
          <div>
            <h2 className="text-lg font-bold text-white mb-1">Exportação da Reunião</h2>
            <p className="text-xs text-slate-400">
              Exporte relatórios em PDF, Texto simples ou copie blocos específicos com um clique.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            <button
              onClick={() => window.print()}
              className="p-5 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs flex flex-col items-center justify-center gap-2 shadow-lg shadow-indigo-600/30 transition-all"
            >
              <Download className="w-6 h-6" />
              <span>EXPORTAR PDF</span>
            </button>

            <button
              onClick={() =>
                copyToClipboard(
                  `RESUMO:\n${summary?.conclusions}\n\nTAREFAS:\n${tasks.map((t) => `- ${t.title} (${t.assignee})`).join("\n")}`,
                  "Resumo Geral Copiado!"
                )
              }
              className="p-5 rounded-2xl bg-slate-900 border border-slate-800 hover:border-indigo-500/40 text-slate-200 font-bold text-xs flex flex-col items-center justify-center gap-2 transition-all"
            >
              <Copy className="w-6 h-6 text-indigo-400" />
              <span>COPIAR RESUMO</span>
            </button>

            <button
              onClick={() =>
                copyToClipboard(
                  tasks.map((t) => `• ${t.title} | Responsável: ${t.assignee} | Prazo: ${t.original_due_date_text}`).join("\n"),
                  "Tarefas Copiadas!"
                )
              }
              className="p-5 rounded-2xl bg-slate-900 border border-slate-800 hover:border-amber-500/40 text-slate-200 font-bold text-xs flex flex-col items-center justify-center gap-2 transition-all"
            >
              <Copy className="w-6 h-6 text-amber-400" />
              <span>COPIAR TAREFAS</span>
            </button>

            <button
              onClick={() =>
                copyToClipboard(
                  decisions.map((d) => `• ${d.decision_text}`).join("\n"),
                  "Decisões Copiadas!"
                )
              }
              className="p-5 rounded-2xl bg-slate-900 border border-slate-800 hover:border-emerald-500/40 text-slate-200 font-bold text-xs flex flex-col items-center justify-center gap-2 transition-all"
            >
              <Copy className="w-6 h-6 text-emerald-400" />
              <span>COPIAR DECISÕES</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
