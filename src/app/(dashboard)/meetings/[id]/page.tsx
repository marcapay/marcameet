"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  FileText,
  Sparkles,
  AlertTriangle,
  Clock,
  DollarSign,
  Calendar,
  Quote,
  TrendingUp,
  Download,
  Upload,
  Copy,
  Edit2,
  Check,
  ArrowLeft,
  Share2,
  Trash2,
  X,
} from "lucide-react";
import { getLocalMeetings, updateSpeakerNameInMeeting, updateMeetingTitle, deleteLocalMeeting, subscribeLocalMeetings } from "@/lib/storage/mockStorage";
import { CompleteMeetingDetails } from "@/types/database";
import { MeetingBoards } from "@/components/meetings/MeetingBoards";
import { MeetingMaterials } from "@/components/meetings/MeetingMaterials";
import { MeetingAccess } from "@/components/meetings/MeetingAccess";
import { MeetingChat } from "@/components/meetings/MeetingChat";
import { ensureValidUuid } from "@/lib/supabase/client";
import Link from "next/link";

export default function MeetingDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [details, setDetails] = useState<CompleteMeetingDetails | null>(null);
  const [activeTab, setActiveTab] = useState<"summary" | "transcript" | "import" | "export">("summary");
  const [loadSlow, setLoadSlow] = useState(false);
  
  const [openMaterialsChat, setOpenMaterialsChat] = useState(false);
  const [selectedSegment, setSelectedSegment] = useState<string | null>(null);
  const [editingSpeaker, setEditingSpeaker] = useState<string | null>(null);
  const [newSpeakerName, setNewSpeakerName] = useState("");
  const [copiedNotification, setCopiedNotification] = useState<string | null>(null);

  // Edição de Título da Reunião
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [newTitle, setNewTitle] = useState("");

  const handleSaveTitle = () => {
    if (!newTitle.trim()) return;
    const updated = updateMeetingTitle(details?.meeting.id || id, newTitle.trim());
    if (updated) {
      setDetails(updated);
      setCopiedNotification("Título da reunião atualizado!");
      setTimeout(() => setCopiedNotification(null), 2500);
    }
    setIsEditingTitle(false);
  };

  useEffect(() => {
    const canonicalId = ensureValidUuid(id);
    const load = (list: CompleteMeetingDetails[]) => {
      setDetails(list.find(({ meeting }) => ensureValidUuid(meeting.id) === canonicalId) || null);
    };
    setLoadSlow(false);
    load(getLocalMeetings());
    const unsubscribe = subscribeLocalMeetings(load);
    const timeout = setTimeout(() => setLoadSlow(true), 5000);
    return () => {
      clearTimeout(timeout);
      unsubscribe();
    };
  }, [id]);

  useEffect(() => {
    if (activeTab === "transcript" && selectedSegment) {
      document.getElementById("trecho-selecionado")?.scrollIntoView({ block: "center" });
    }
  }, [activeTab, selectedSegment]);

  function openTranscriptAt(seconds: number) {
    const segments = details?.transcript?.segments || [];
    const match = segments.find((segment) => Math.floor(segment.start_time) === seconds)
      ?? segments.find((segment) => segment.start_time <= seconds && seconds < segment.end_time);
    setSelectedSegment(match?.id ?? null);
    setActiveTab("transcript");
  }

  if (!details) {
    return (
      <div className="p-12 text-center space-y-4">
        <Sparkles className="w-10 h-10 text-indigo-400 mx-auto animate-spin" />
        <p role="status" className="text-sm font-medium text-slate-300">
          {loadSlow ? "A reunião ainda não está disponível neste aparelho." : "Carregando detalhes da reunião…"}
        </p>
        <Link href="/meetings" className="inline-flex min-h-11 items-center text-indigo-300">Voltar para Minhas Reuniões</Link>
      </div>
    );
  }

  const { meeting, summary, transcript, decisions, tasks, values, next_steps_agreed } = details;

  // Atualizar Nome de Participante (Edição Global em toda a reunião - Req #8)
  const handleSaveSpeakerName = (oldSpeaker: string) => {
    if (!newSpeakerName.trim()) return;
    const updated = updateSpeakerNameInMeeting(meeting.id, oldSpeaker, newSpeakerName.trim());
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
        <div className="flex flex-wrap items-center gap-2">
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
            onClick={async () => {
              if (confirm(`Tem certeza que deseja excluir a reunião "${meeting.title}"?`)) {
                const completed = await deleteLocalMeeting(meeting.id);
                if (!completed) {
                  alert("Não foi possível excluir. Se houver uma versão compartilhada, entre com o e-mail verificado do proprietário e tente novamente.");
                  return;
                }
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

      {/* Abas Principais em Container Único Compacto */}
      <div id="abas-da-reuniao" className="scroll-mt-24 p-1 rounded-2xl bg-slate-900/90 border border-slate-800 flex items-center justify-between gap-1 w-full max-w-full overflow-hidden shadow-inner">
        <button
          onClick={() => setActiveTab("summary")}
          className={`flex-1 py-2 px-1.5 sm:px-3 rounded-xl font-bold text-[10px] sm:text-xs flex items-center justify-center gap-1 transition-all whitespace-nowrap ${
            activeTab === "summary"
              ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          <Sparkles className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">Análise IA</span>
        </button>

        <button
          onClick={() => { setOpenMaterialsChat(false); setActiveTab("transcript"); }}
          className={`flex-1 py-2 px-1.5 sm:px-3 rounded-xl font-bold text-[10px] sm:text-xs flex items-center justify-center gap-1 transition-all whitespace-nowrap ${
            activeTab === "transcript"
              ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          <FileText className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">Transcrição</span>
        </button>

        <button
          onClick={() => setActiveTab("import")}
          className={`flex-1 py-2 px-1.5 sm:px-3 rounded-xl font-bold text-[10px] sm:text-xs flex items-center justify-center gap-1 transition-all whitespace-nowrap ${
            activeTab === "import"
              ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          <Upload className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">Importar</span>
        </button>

        <button
          onClick={() => setActiveTab("export")}
          className={`flex-1 py-2 px-1.5 sm:px-3 rounded-xl font-bold text-[10px] sm:text-xs flex items-center justify-center gap-1 transition-all whitespace-nowrap ${
            activeTab === "export"
              ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          <Download className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">Exportar</span>
        </button>
      </div>

      <MeetingAccess key={meeting.id} details={details} />

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

          <MeetingBoards key={meeting.id} details={details} onTimestamp={openTranscriptAt} />

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

      {activeTab === "transcript" && (
        <div className="space-y-6">
          <MeetingChat details={details} executive voiceComposer openMaterials={openMaterialsChat} onTimestamp={openTranscriptAt} />
          {Object.keys(transcript?.speaker_map || {}).length > 0 && (
            <div className="p-4 sm:p-6 rounded-3xl glass-card border border-slate-800 space-y-4" id="participantes">
              <h2 className="text-sm font-semibold text-slate-200">Participantes</h2>
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
          )}
          <section className="rounded-3xl glass-card border border-slate-800 p-4 sm:p-6 space-y-4">
            <h2 className="text-lg font-semibold text-slate-100">Resumo em blocos</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                { title: "Objetivo", items: [summary?.objective] },
                { title: "Assuntos discutidos", items: summary?.key_topics || [] },
                { title: "Decisões", items: decisions.map((decision) => decision.decision_text) },
                { title: "Próximos passos", items: next_steps_agreed?.length ? next_steps_agreed : tasks.map((task) => task.title) },
                { title: "Conclusão", items: [summary?.conclusions] },
              ].map(({ title, items }) => {
                const entries = items.filter((item) => item?.trim());
                if (!entries.length) return null;
                return (
                  <div key={title} className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 space-y-2">
                    <h3 className="text-sm font-semibold text-indigo-200">{title}</h3>
                    <ul className="space-y-1 pl-4 list-disc text-sm text-slate-300">
                      {entries.slice(0, 5).map((entry, index) => <li key={index}>{entry}</li>)}
                    </ul>
                    {entries.length > 5 && <p className="text-xs text-slate-400">Consulte Análise IA para ver mais.</p>}
                  </div>
                );
              })}
            </div>
            {!summary?.objective && !summary?.key_topics?.length && !summary?.conclusions &&
              !decisions.length && !tasks.length && !next_steps_agreed?.length && (
              <p className="text-sm text-slate-400">Use a barra acima para pedir um resumo da transcrição.</p>
            )}
          </section>
          {selectedSegment && (() => {
            const segment = transcript?.segments?.find(({ id }) => id === selectedSegment);
            if (!segment) return null;
            return (
              <section id="trecho-selecionado" className="rounded-2xl border border-indigo-500/30 p-4 text-sm space-y-2">
                <h2 className="font-semibold text-indigo-200">Trecho selecionado · {formatTimestamp(segment.start_time)}</h2>
                <p className="text-slate-300">{segment.text}</p>
                <button type="button" onClick={() => setSelectedSegment(null)} className="min-h-11 text-indigo-200">Fechar trecho</button>
              </section>
            );
          })()}
        </div>
      )}

      {activeTab === "import" && (
        <MeetingMaterials key={meeting.id} details={details} onOpenChat={() => { setOpenMaterialsChat(true); setActiveTab("transcript"); }} />
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
