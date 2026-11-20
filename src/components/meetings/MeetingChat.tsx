"use client";

import { useState, type FormEvent } from "react";
import { MessageSquare, Send } from "lucide-react";
import { MeetingAnswer } from "./MeetingAnswer";
import { askMeetingAI, type MeetingChatMessage } from "@/lib/ai";
import type { CompleteMeetingDetails } from "@/types/database";

const executivePrompts = [
  ["Resumo", "Faça um resumo executivo com decisões, responsáveis e próximos passos."],
  ["Relatório", "Prepare um relatório executivo com contexto, decisões, riscos e plano de ação. Separe fatos e recomendações."],
  ["Mensagem", "Redija uma mensagem de acompanhamento pronta para copiar, com o que foi combinado, os responsáveis e os prazos."],
  ["Apresentação", "Crie uma apresentação executiva breve. Use um título no formato ## Slide 1: Título, ## Slide 2: Título e assim por diante, com os pontos de cada slide abaixo."],
  ["Estudo", "Analise as alternativas discutidas, as evidências, os riscos e o que precisa ser investigado. Separe fatos da reunião e hipóteses."],
  ["Gráfico", "Crie um gráfico com os dados numéricos comparáveis registrados na reunião e indique sua fonte. Se faltarem números, explique o que está faltando."],
];

function Conversation({ details, executive }: { details: CompleteMeetingDetails; executive?: boolean }) {
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<MeetingChatMessage[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const ready = Boolean(
    details.transcript?.segments?.some((segment) => segment.text?.trim()) ||
    details.transcript?.raw_text?.trim() || details.summary?.objective || details.decisions?.length || details.tasks?.length
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = question.trim();
    if (!ready || !content || pending) return;
    setPending(true);
    setError("");
    setQuestion("");
    const timestamp = new Date().toISOString();
    const message: MeetingChatMessage = { id: timestamp, role: "user", content, timestamp };
    setMessages([...messages, message]);
    try {
      const answer = await askMeetingAI(details, content, messages);
      setMessages((current) => [...current, { id: `${timestamp}-answer`, role: "assistant", content: answer, timestamp }]);
    } catch {
      setError("Não foi possível responder agora. Tente novamente.");
      setQuestion(content);
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-label="Pergunte sobre esta reunião" className="glass-card rounded-2xl p-4 sm:p-6 space-y-3">
      <h2 className="flex items-center gap-2 text-base font-semibold text-slate-100">
        <MessageSquare className="h-5 w-5 text-indigo-300" aria-hidden="true" />
        {executive ? "Assistente executivo da reunião" : "Pergunte sobre esta reunião"}
      </h2>
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
      {messages.length > 0 && (
        <div role="log" aria-label="Conversa sobre a reunião" className="max-h-80 space-y-3 overflow-y-auto">
          {messages.map((message) => (
            <div key={message.id} className={`rounded-xl p-3 text-sm ${message.role === "user" ? "bg-indigo-600/15" : "bg-slate-900/80"}`}>
              <p className="mb-1 text-xs font-medium text-indigo-300">{message.role === "user" ? "Você" : "Marca Reuniões"}</p>
              {message.role === "assistant"
                ? <MeetingAnswer content={message.content} title={details.meeting.title} />
                : <p className="whitespace-pre-wrap break-words text-slate-100">{message.content}</p>}
            </div>
          ))}
        </div>
      )}
      <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
        <input
          aria-label="Sua pergunta"
          placeholder="Ex.: O que ficou decidido sobre o prazo?"
          value={question}
          maxLength={2000}
          onChange={(event) => setQuestion(event.target.value)}
          disabled={!ready || pending}
          className="min-h-11 min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 text-base text-slate-100 focus-visible:outline focus-visible:outline-indigo-400"
        />
        <button type="submit" disabled={!ready || pending || !question.trim()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-medium text-white disabled:opacity-50">
          <Send className="h-4 w-4" aria-hidden="true" /> Enviar
        </button>
      </form>
      {!ready && <p className="text-sm text-slate-400">O chat fica disponível quando houver transcrição, resumo ou decisões para consultar.</p>}
      {pending && <p role="status" className="text-sm text-slate-300">Buscando na transcrição…</p>}
      {error && <p role="alert" className="text-sm text-amber-200">{error}</p>}
    </section>
  );
}

export function MeetingChat({ details, executive }: { details: CompleteMeetingDetails; executive?: boolean }) {
  return <Conversation key={details.meeting.id} details={details} executive={executive} />;
}
