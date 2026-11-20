"use client";

import { useEffect, useRef, useState } from "react";
import { MessageSquare, Send, UserCheck } from "lucide-react";
import { MeetingMaterials } from "./MeetingMaterials";
import { QuestionDictation } from "./QuestionDictation";
import { MeetingAnswer } from "./MeetingAnswer";
import { askMeetingAI, askMeetingMaterialsWithOpenAI, type MeetingChatMessage } from "@/lib/ai";
import type { CompleteMeetingDetails } from "@/types/database";

const executivePrompts = [
  ["Buscar trecho", "Em que momento da reunião foi discutido "],
  ["Vídeo", "Crie um vídeo curto com as decisões e os próximos passos da reunião."],
  ["Resumo", "Faça um resumo executivo com decisões, responsáveis e próximos passos."],
  ["Relatório", "Prepare um relatório executivo com contexto, decisões, riscos e plano de ação. Separe fatos e recomendações."],
  ["Mensagem", "Redija uma mensagem de acompanhamento pronta para copiar, com o que foi combinado, os responsáveis e os prazos."],
  ["Apresentação", "Crie uma apresentação executiva breve. Use um título no formato ## Slide 1: Título, ## Slide 2: Título e assim por diante, com os pontos de cada slide abaixo."],
  ["Estudo", "Analise as alternativas discutidas, as evidências, os riscos e o que precisa ser investigado. Separe fatos da reunião e hipóteses."],
  ["Gráfico", "Crie um gráfico com os dados numéricos comparáveis registrados na reunião e indique sua fonte. Se faltarem números, explique o que está faltando."],
];

interface MeetingChatProps {
  details: CompleteMeetingDetails;
  executive?: boolean;
  voiceComposer?: boolean;
  openMaterials?: boolean;
  onTimestamp?: (seconds: number) => void;
}

function Conversation({ details, executive, voiceComposer, openMaterials, onTimestamp }: MeetingChatProps) {
  const [consultMaterials, setConsultMaterials] = useState(Boolean(openMaterials));
  const [question, setQuestion] = useState("");
  const historyKey = `marca-reunioes-chat-v1:${details.meeting.user_id}:${details.meeting.id}`;
  const [messages, setMessages] = useState<MeetingChatMessage[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(historyKey) || "[]");
      return Array.isArray(saved) ? saved.filter((item) =>
        item && typeof item.id === "string" && typeof item.content === "string" &&
        (item.role === "user" || item.role === "assistant")
      ).slice(-40) : [];
    } catch {
      return [];
    }
  });
  const [historySearch, setHistorySearch] = useState("");
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const log = useRef<HTMLDivElement>(null);
  const [dictating, setDictating] = useState(false);
  const [error, setError] = useState("");
  const ready = Boolean(
    details.transcript?.segments?.some((segment) => segment.text?.trim()) ||
    details.transcript?.raw_text?.trim() || details.support_materials?.length || details.summary?.objective || details.decisions?.length || details.tasks?.length
  );

  async function send(text: string) {
    const content = text.trim().slice(0, 2000);
    if (!ready || !content || submitting.current) return;
    submitting.current = true;
    setPending(true);
    setHistorySearch("");
    setError("");
    setQuestion("");
    const timestamp = new Date().toISOString();
    const scope = consultMaterials ? "materials" : undefined;
    const message: MeetingChatMessage = { id: timestamp, role: "user", content, timestamp, scope };
    setMessages([...messages, message]);
    try {
      const answer = consultMaterials
        ? await askMeetingMaterialsWithOpenAI(details, content, messages)
        : await askMeetingAI(details, content, messages.filter((message) => message.scope !== "materials").slice(-20));
      const updated: MeetingChatMessage[] = [...messages, message, {
        id: `${timestamp}-answer`, role: "assistant", content: answer, timestamp, scope,
      }];
      setMessages(updated.slice(-40));
      try {
        localStorage.setItem(historyKey, JSON.stringify(updated.slice(-40)));
      } catch {
        // A conversa continua disponível enquanto a página estiver aberta.
      }
    } catch (error) {
      setMessages(messages);
      setError(consultMaterials && error instanceof Error ? error.message : "Não foi possível responder agora. Tente novamente.");
      setQuestion(content);
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  useEffect(() => {
    if (!historySearch && log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [messages, historySearch]);

  function renderConversation() {
    return (
      <>
        {!ready && <p className="text-sm text-slate-400">O chat fica disponível quando houver transcrição, resumo ou decisões para consultar.</p>}
        {pending && <p role="status" className="text-sm text-slate-300">Consultando a reunião…</p>}
        {error && <p role="alert" className="text-sm text-amber-200">{error}</p>}
        {executive && messages.length > 0 && (
          <input type="search" aria-label="Buscar nesta conversa" placeholder="Buscar nesta conversa"
            value={historySearch} onChange={(event) => setHistorySearch(event.target.value)}
            className="min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100" />
        )}
        {messages.length > 0 && (
          <div ref={log} role="log" aria-label="Conversa sobre a reunião" className="max-h-80 space-y-3 overflow-y-auto">
            {messages.filter((message) => message.content.toLocaleLowerCase("pt-BR")
              .includes(historySearch.trim().toLocaleLowerCase("pt-BR"))).map((message) => (
              <div key={message.id} className={`rounded-xl p-3 text-sm ${message.role === "user" ? "bg-indigo-600/15" : "bg-slate-900/80"}`}>
                <p className="mb-1 text-xs font-medium text-indigo-300">{message.role === "user" ? "Você" : "Marca Reuniões"}</p>
                {message.role === "assistant"
                  ? <MeetingAnswer content={message.content} title={details.meeting.title} onTimestamp={onTimestamp} />
                  : <p className="whitespace-pre-wrap break-words text-slate-100">{message.content}</p>}
              </div>
            ))}
          </div>
        )}
      </>
    );
  }

  function renderComposer() {
    return (
      <div className="space-y-2">
        {Boolean(details.support_materials?.length) && (
          <label className="flex items-center gap-2 text-sm text-indigo-200">
            <input type="checkbox" checked={consultMaterials} disabled={pending} onChange={(event) => setConsultMaterials(event.target.checked)} />
            Incluir texto dos anexos na análise da OpenAI
          </label>
        )}
        <form aria-label="Perguntar ao assistente"
          onSubmit={(event) => { event.preventDefault(); if (!dictating) void send(question); }} className="flex flex-wrap items-start gap-2">
          <input
            aria-label="Sua pergunta"
            placeholder="Ex.: O que ficou decidido sobre o prazo?"
            value={question}
            maxLength={2000}
            onChange={(event) => setQuestion(event.target.value)}
            disabled={!ready || pending}
            className="min-h-11 min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 text-base text-slate-100 focus-visible:outline focus-visible:outline-indigo-400"
          />
          <button type="submit" disabled={!ready || pending || dictating || !question.trim()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-medium text-white disabled:opacity-50">
            <Send className="h-4 w-4" aria-hidden="true" /> Enviar
          </button>
          <QuestionDictation disabled={!ready || pending}
            sendOnEnd={voiceComposer} onListening={setDictating} onText={(text) => {
            if (voiceComposer) {
              void send(text);
            } else {
              setQuestion((value) => `${value.trim()} ${text}`.trim().slice(0, 2000));
            }
          }} />
          {voiceComposer && <MeetingMaterials details={details} compact />}
          {voiceComposer && Object.keys(details.transcript?.speaker_map || {}).length > 0 && (
            <a href="#participantes" className="inline-flex min-h-11 items-center gap-1 px-1 text-xs font-semibold text-indigo-200">
              <UserCheck className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Participantes</span>
              <span className="sr-only sm:hidden">Participantes</span>
            </a>
          )}
        </form>
      </div>
    );
  }

  return (
    <section aria-label="Pergunte sobre esta reunião" className="scroll-mt-28 glass-card rounded-2xl p-4 sm:p-6 space-y-3">
      <h2 className="flex items-center gap-2 text-base font-semibold text-slate-100">
        <MessageSquare className="h-5 w-5 text-indigo-300" aria-hidden="true" />
        {executive ? "Assistente executivo da reunião" : "Pergunte sobre esta reunião"}
      </h2>
      {renderComposer()}
      {executive && (
        <div className="flex flex-wrap gap-2" aria-label="Modelos de pedido">
          {executivePrompts.map(([label, prompt]) => (
            <button key={label} type="button" disabled={!ready || pending} onClick={() => setQuestion(prompt)}
              className="min-h-11 rounded-xl border border-indigo-400/25 px-3 text-sm text-indigo-200 hover:bg-indigo-600/20 disabled:opacity-50">
              {label}
            </button>
          ))}
        </div>
      )}
      {renderConversation()}
    </section>
  );
}

export function MeetingChat(props: MeetingChatProps) {
  return <Conversation key={`${props.details.meeting.user_id}:${props.details.meeting.id}`} {...props} />;
}
