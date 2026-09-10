"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Search, Sparkles, Clock, Calendar, ArrowRight, Award, CheckSquare, AlertTriangle, DollarSign, FileText } from "lucide-react";
import { getLocalMeetings } from "@/lib/storage/mockStorage";
import { CompleteMeetingDetails } from "@/types/database";

interface SearchResultItem {
  meetingId: string;
  meetingTitle: string;
  meetingDate: string;
  typeLabel: "Transcrição" | "Decisão" | "Tarefa" | "Risco" | "Valor" | "Resumo";
  snippet: string;
  timestamp?: number;
}

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [allMeetings, setAllMeetings] = useState<CompleteMeetingDetails[]>([]);

  useEffect(() => {
    setAllMeetings(getLocalMeetings());
  }, []);

  const exampleQueries = [
    "reuniões que falaram sobre financiamento",
    "quando foi mencionado o valor de R$ 350.000",
    "tarefas relacionadas a design",
    "decisões tomadas em agosto",
    "riscos sobre atraso no lançamento",
  ];

  const handleSearch = (searchTerm: string) => {
    setQuery(searchTerm);
    if (!searchTerm.trim()) {
      setResults([]);
      return;
    }

    const term = searchTerm.toLowerCase();
    const matches: SearchResultItem[] = [];

    allMeetings.forEach((item) => {
      // 1. Pesquisar nas Decisões
      item.decisions.forEach((d) => {
        if (d.decision_text.toLowerCase().includes(term)) {
          matches.push({
            meetingId: item.meeting.id,
            meetingTitle: item.meeting.title,
            meetingDate: item.meeting.meeting_date,
            typeLabel: "Decisão",
            snippet: d.decision_text,
            timestamp: d.timestamp_start,
          });
        }
      });

      // 2. Pesquisar nas Tarefas
      item.tasks.forEach((t) => {
        if (t.title.toLowerCase().includes(term) || (t.description && t.description.toLowerCase().includes(term))) {
          matches.push({
            meetingId: item.meeting.id,
            meetingTitle: item.meeting.title,
            meetingDate: item.meeting.meeting_date,
            typeLabel: "Tarefa",
            snippet: `${t.title} (${t.assignee})`,
            timestamp: t.timestamp_start,
          });
        }
      });

      // 3. Pesquisar nos Valores
      item.values.forEach((v) => {
        if (v.amount_formatted.toLowerCase().includes(term) || (v.context && v.context.toLowerCase().includes(term))) {
          matches.push({
            meetingId: item.meeting.id,
            meetingTitle: item.meeting.title,
            meetingDate: item.meeting.meeting_date,
            typeLabel: "Valor",
            snippet: `${v.amount_formatted}: ${v.context}`,
            timestamp: v.timestamp_start,
          });
        }
      });

      // 4. Pesquisar nos Riscos
      item.risks.forEach((r) => {
        if (r.description.toLowerCase().includes(term)) {
          matches.push({
            meetingId: item.meeting.id,
            meetingTitle: item.meeting.title,
            meetingDate: item.meeting.meeting_date,
            typeLabel: "Risco",
            snippet: r.description,
            timestamp: r.timestamp_start,
          });
        }
      });

      // 5. Pesquisar nos Segmentos da Transcrição
      item.transcript?.segments?.forEach((seg) => {
        if (seg.text.toLowerCase().includes(term)) {
          matches.push({
            meetingId: item.meeting.id,
            meetingTitle: item.meeting.title,
            meetingDate: item.meeting.meeting_date,
            typeLabel: "Transcrição",
            snippet: `"${seg.text}" — ${seg.speaker}`,
            timestamp: seg.start_time,
          });
        }
      });
    });

    setResults(matches);
  };

  const getTypeBadge = (type: string) => {
    switch (type) {
      case "Decisão":
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">Decisão</span>;
      case "Tarefa":
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">Tarefa</span>;
      case "Risco":
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30">Risco</span>;
      case "Valor":
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30">Valor</span>;
      default:
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">{type}</span>;
    }
  };

  const formatTime = (sec?: number) => {
    if (sec === undefined || sec === null) return null;
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-black text-white flex items-center gap-2">
          <Search className="w-6 h-6 text-indigo-400" />
          <span>Pesquisa Inteligente</span>
        </h1>
        <p className="text-xs text-slate-400">
          Pesquise por termos, decisões, valores e memórias semânticas de todas as reuniões.
        </p>
      </div>

      {/* Main Search Input */}
      <div className="p-6 rounded-3xl glass-card border border-indigo-500/30 space-y-4 shadow-xl">
        <div className="relative">
          <Search className="w-5 h-5 text-indigo-400 absolute left-4 top-3.5" />
          <input
            type="text"
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Pesquise em suas reuniões (ex: orçamentos, decisões, setembro...)"
            className="w-full pl-12 pr-4 py-3.5 rounded-2xl bg-slate-900 border border-slate-800 text-slate-100 text-sm focus:outline-none focus:border-indigo-500 transition-colors shadow-inner"
          />
        </div>

        {/* Sugestões de Exemplo */}
        <div className="space-y-1.5 pt-1">
          <span className="text-[11px] font-semibold text-slate-400 block">Exemplos de busca:</span>
          <div className="flex flex-wrap gap-2">
            {exampleQueries.map((ex, idx) => (
              <button
                key={idx}
                onClick={() => handleSearch(ex.replace("reuniões que falaram sobre ", "").replace("quando foi mencionado o ", ""))}
                className="px-3 py-1 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-indigo-300 text-xs transition-colors"
              >
                "{ex}"
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Resultados de Busca */}
      {query && (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs text-slate-400 font-semibold px-1">
            <span>Resultados encontrados para "{query}"</span>
            <span className="text-indigo-400 font-bold">{results.length} itens</span>
          </div>

          {results.length === 0 ? (
            <div className="p-12 rounded-3xl bg-slate-900/40 border border-slate-800 text-center space-y-2">
              <Sparkles className="w-10 h-10 text-slate-600 mx-auto" />
              <p className="text-sm font-semibold text-slate-300">Nenhum resultado encontrado para esta pesquisa.</p>
              <p className="text-xs text-slate-500">Tente buscar por palavras-chave mais simples.</p>
            </div>
          ) : (
            results.map((res, index) => (
              <Link
                key={index}
                href={`/meetings/${res.meetingId}`}
                className="block p-4 rounded-2xl glass-card border border-slate-800 hover:border-indigo-500/40 transition-all group"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center gap-2">
                      {getTypeBadge(res.typeLabel)}
                      <span className="text-xs font-bold text-slate-200 group-hover:text-indigo-300 transition-colors">
                        {res.meetingTitle}
                      </span>
                    </div>
                    <p className="text-xs text-slate-300 leading-relaxed font-sans">{res.snippet}</p>
                  </div>

                  <div className="flex items-center gap-3 text-xs text-slate-400 shrink-0 border-t sm:border-t-0 border-slate-800 pt-2 sm:pt-0">
                    {res.timestamp !== undefined && (
                      <span className="font-mono text-indigo-400 text-[11px] flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatTime(res.timestamp)}
                      </span>
                    )}
                    <span className="text-[10px] text-slate-500">
                      {new Date(res.meetingDate).toLocaleDateString("pt-BR")}
                    </span>
                    <ArrowRight className="w-4 h-4 text-slate-500 group-hover:text-indigo-400 group-hover:translate-x-1 transition-all" />
                  </div>
                </div>
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  );
}
