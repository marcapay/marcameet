"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Search, Filter, Video, Mic, Upload, FileText, Calendar, Clock, ArrowRight, Tag, RefreshCw, Trash2, Edit2 } from "lucide-react";
import { getLocalMeetings, deleteLocalMeeting, updateMeetingTitle } from "@/lib/storage/mockStorage";
import { CompleteMeetingDetails, MeetingStatus } from "@/types/database";

export default function MeetingsPage() {
  const [meetings, setMeetings] = useState<CompleteMeetingDetails[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedStatus, setSelectedStatus] = useState<string>("ALL");
  const [selectedTag, setSelectedTag] = useState<string>("ALL");

  const reloadMeetings = () => {
    setMeetings(getLocalMeetings());
  };

  useEffect(() => {
    reloadMeetings();
  }, []);

  const handleDeleteMeeting = async (e: React.MouseEvent, meetingId: string, title: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (confirm(`Tem certeza que deseja excluir a reunião "${title}"?`)) {
      await deleteLocalMeeting(meetingId);
      reloadMeetings();
    }
  };

  const handleRenameMeeting = (e: React.MouseEvent, meetingId: string, currentTitle: string) => {
    e.preventDefault();
    e.stopPropagation();
    const newTitle = prompt("Novo título para a reunião:", currentTitle);
    if (newTitle && newTitle.trim() && newTitle.trim() !== currentTitle) {
      updateMeetingTitle(meetingId, newTitle.trim());
      reloadMeetings();
    }
  };

  // Extrair todas as tags únicas
  const allTags = Array.from(
    new Set(meetings.flatMap((m) => m.meeting.tags || []))
  );

  // Filtragem
  const filteredMeetings = meetings.filter((item) => {
    const matchesSearch =
      item.meeting.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.meeting.description && item.meeting.description.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (item.summary?.objective && item.summary.objective.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesStatus = selectedStatus === "ALL" || item.meeting.status === selectedStatus;
    const matchesTag = selectedTag === "ALL" || (item.meeting.tags && item.meeting.tags.includes(selectedTag));

    return matchesSearch && matchesStatus && matchesTag;
  });

  const getSourceIcon = (source: string) => {
    switch (source) {
      case "recording":
        return <Mic className="w-3.5 h-3.5 text-rose-400" />;
      case "audio_upload":
        return <Upload className="w-3.5 h-3.5 text-indigo-400" />;
      case "video_upload":
        return <Video className="w-3.5 h-3.5 text-purple-400" />;
      case "pasted_text":
        return <FileText className="w-3.5 h-3.5 text-emerald-400" />;
      default:
        return <Video className="w-3.5 h-3.5 text-slate-400" />;
    }
  };

  const getStatusBadge = (status: MeetingStatus) => {
    switch (status) {
      case "CONCLUIDA":
        return <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">CONCLUÍDA</span>;
      case "TRANSCREVENDO":
        return <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 animate-pulse">TRANSCREVENDO</span>;
      case "ANALISANDO":
        return <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-purple-500/20 text-purple-300 border border-purple-500/30 animate-pulse">ANALISANDO</span>;
      case "ERRO":
        return <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-rose-500/20 text-rose-300 border border-rose-500/30">ERRO</span>;
      default:
        return <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-slate-500/20 text-slate-300 border border-slate-500/30">{status}</span>;
    }
  };

  const formatDuration = (seconds: number) => {
    if (!seconds) return "N/A";
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header da Página */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-white flex items-center gap-2">
            <Video className="w-6 h-6 text-indigo-400" />
            <span>Minhas Reuniões</span>
          </h1>
          <p className="text-xs text-slate-400">
            Gerencie, consulte, filtre ou exclua o histórico de reuniões processadas.
          </p>
        </div>

        <Link
          href="/record"
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-rose-600 to-indigo-600 hover:from-rose-500 hover:to-indigo-500 text-white font-bold text-xs shadow-lg shadow-rose-600/20 transition-all active:scale-95"
        >
          <Mic className="w-4 h-4" />
          <span>NOVA REUNIÃO</span>
        </Link>
      </div>

      {/* Busca e Filtros */}
      <div className="p-4 rounded-2xl glass-card border border-slate-800 space-y-3">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
          <input
            type="text"
            placeholder="Pesquise por título, assunto, palavra-chave..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-100 text-sm focus:outline-none focus:border-indigo-500 transition-colors"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
          <div className="flex items-center gap-1 text-slate-400 mr-2 font-semibold">
            <Filter className="w-3.5 h-3.5" />
            <span>Filtros:</span>
          </div>

          {/* Filtro Status */}
          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-200 text-xs focus:outline-none"
          >
            <option value="ALL">Todos os Status</option>
            <option value="CONCLUIDA">Concluídas</option>
            <option value="TRANSCREVENDO">Transcrevendo</option>
            <option value="ANALISANDO">Analisando</option>
            <option value="ERRO">Com Erro</option>
          </select>

          {/* Filtro Tag */}
          <select
            value={selectedTag}
            onChange={(e) => setSelectedTag(e.target.value)}
            className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-200 text-xs focus:outline-none"
          >
            <option value="ALL">Todas as Tags</option>
            {allTags.map((tag) => (
              <option key={tag} value={tag}>
                {tag}
              </option>
            ))}
          </select>

          {(selectedStatus !== "ALL" || selectedTag !== "ALL" || searchQuery) && (
            <button
              onClick={() => {
                setSearchQuery("");
                setSelectedStatus("ALL");
                setSelectedTag("ALL");
              }}
              className="text-indigo-400 hover:underline font-medium text-[11px] ml-auto"
            >
              Limpar Filtros
            </button>
          )}
        </div>
      </div>

      {/* Lista de Reuniões */}
      <div className="space-y-3">
        {filteredMeetings.length === 0 ? (
          <div className="p-12 rounded-3xl bg-slate-900/40 border border-slate-800 text-center space-y-3">
            <Video className="w-12 h-12 text-slate-600 mx-auto" />
            <p className="text-sm font-semibold text-slate-300">Nenhuma reunião encontrada.</p>
            <p className="text-xs text-slate-500">Tente ajustar os filtros ou realizar uma nova gravação.</p>
          </div>
        ) : (
          filteredMeetings.map((item) => (
            <div
              key={item.meeting.id}
              className="p-5 rounded-2xl glass-card glass-card-hover border border-slate-800/80 transition-all group flex flex-col md:flex-row md:items-center justify-between gap-4"
            >
              <Link href={`/meetings/${item.meeting.id}`} className="space-y-2 flex-1 block">
                <div className="flex flex-wrap items-center gap-2">
                  {getStatusBadge(item.meeting.status)}
                  <span className="flex items-center gap-1 text-[11px] text-slate-400 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                    {getSourceIcon(item.meeting.source_type)}
                    <span className="capitalize">{item.meeting.source_type.replace("_", " ")}</span>
                  </span>
                  <span className="text-xs text-slate-400 flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    {new Date(item.meeting.meeting_date).toLocaleDateString("pt-BR", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>

                <h3 className="font-bold text-slate-100 text-base group-hover:text-indigo-300 transition-colors">
                  {item.meeting.title}
                </h3>

                <p className="text-xs text-slate-400 line-clamp-2">
                  {item.summary?.objective || item.meeting.description || "Sem resumo disponível."}
                </p>

                {/* Tags */}
                {item.meeting.tags && item.meeting.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {item.meeting.tags.map((tag) => (
                      <span key={tag} className="text-[10px] font-semibold px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}
              </Link>

              {/* Resumo de Indicadores + Botão de Excluir */}
              <div className="flex items-center justify-between md:justify-end gap-4 text-xs text-slate-400 border-t md:border-t-0 md:border-l border-slate-800 pt-3 md:pt-0 md:pl-6 shrink-0">
                <div className="flex items-center gap-4">
                  <div className="text-center">
                    <span className="block font-black text-slate-100 text-sm">{formatDuration(item.meeting.duration_seconds)}</span>
                    <span className="text-[10px] text-slate-500">Duração</span>
                  </div>

                  <div className="text-center">
                    <span className="block font-black text-indigo-400 text-sm">{item.tasks?.length || item.meeting.tasks_count || 0}</span>
                    <span className="text-[10px] text-slate-500">Tarefas</span>
                  </div>

                  <div className="text-center">
                    <span className="block font-black text-emerald-400 text-sm">{item.decisions?.length || item.meeting.decisions_count || 0}</span>
                    <span className="text-[10px] text-slate-500">Decisões</span>
                  </div>

                  <div className="text-center">
                    <span className="block font-black text-purple-400 text-sm">{item.highlights?.length || item.meeting.highlights_count || 0}</span>
                    <span className="text-[10px] text-slate-500">Pontos</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 pl-2">
                  <button
                    type="button"
                    onClick={(e) => handleRenameMeeting(e, item.meeting.id, item.meeting.title)}
                    className="p-2 rounded-xl bg-slate-900/90 hover:bg-indigo-600/20 text-slate-400 hover:text-indigo-400 border border-slate-800 hover:border-indigo-500/40 transition-all"
                    title="Renomear Reunião"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>

                  <button
                    type="button"
                    onClick={(e) => handleDeleteMeeting(e, item.meeting.id, item.meeting.title)}
                    className="p-2 rounded-xl bg-slate-900/90 hover:bg-rose-600/20 text-slate-400 hover:text-rose-400 border border-slate-800 hover:border-rose-500/40 transition-all"
                    title="Excluir Reunião do site e do Supabase"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>

                  <Link href={`/meetings/${item.meeting.id}`} className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white border border-slate-800 transition-colors">
                    <ArrowRight className="w-4 h-4 group-hover:text-indigo-400 group-hover:translate-x-0.5 transition-all" />
                  </Link>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
