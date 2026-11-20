"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";

interface Dictation {
  lang: string;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

interface MeetingTitleFieldsProps {
  title: string;
  participants: string;
  onTitle: (value: string) => void;
  onParticipants: (value: string) => void;
  onListening: (value: boolean) => void;
  disabled?: boolean;
}

export function MeetingTitleFields({ title, participants, onTitle, onParticipants, onListening, disabled }: MeetingTitleFieldsProps) {
  const titleId = useId();
  const participantsId = useId();
  const recognition = useRef<Dictation | null>(null);
  const [listening, setListening] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => () => {
    if (recognition.current) {
      recognition.current.onend = null;
      recognition.current.onresult = null;
      recognition.current.onerror = null;
      recognition.current.abort();
      recognition.current = null;
    }
    onListening(false);
  }, [onListening]);

  function dictate() {
    if (recognition.current) {
      recognition.current.stop();
      return;
    }

    const browser = window as Window & {
      SpeechRecognition?: new () => Dictation;
      webkitSpeechRecognition?: new () => Dictation;
    };
    const SpeechRecognition = browser.SpeechRecognition || browser.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setMessage("Este navegador não oferece ditado. Você pode digitar o título e os nomes.");
      return;
    }

    const session = new SpeechRecognition();
    session.lang = "pt-BR";
    session.onresult = (event) => {
      const speech = Array.from(event.results).map((result) => result[0]?.transcript || "").join(" ").trim();
      const separator = /[,.;:]?\s*\b(?:participantes(?:\s+(?:são|da reunião))?|estão comigo|quem está comigo)\s*[:,]?\s+/i;
      const [subject, names] = speech.split(separator, 2);
      const cleanTitle = subject?.replace(/^\s*(?:título|assunto)(?:\s+da reunião)?\s*[:,-]?\s+/i, "").trim();
      if (cleanTitle) onTitle(cleanTitle[0].toLocaleUpperCase("pt-BR") + cleanTitle.slice(1));
      if (names?.trim()) onParticipants(names.replace(/[.!?]+$/, "").trim());
      setMessage(speech ? "Confira o título e os nomes antes de gravar." : "Não consegui ouvir o ditado.");
    };
    const finish = () => {
      if (recognition.current !== session) return;
      recognition.current = null;
      setListening(false);
      onListening(false);
    };
    session.onend = finish;
    session.onerror = () => {
      setMessage("Não consegui usar o microfone para ditar. Confira a permissão ou digite os campos.");
      finish();
    };

    try {
      recognition.current = session;
      setListening(true);
      onListening(true);
      setMessage("Ouvindo… diga o assunto e quem está com você.");
      session.start();
    } catch {
      session.onerror();
    }
  }

  const field = "min-h-11 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 text-base text-slate-100 focus-visible:outline focus-visible:outline-indigo-400 disabled:opacity-50";
  return (
    <div className="space-y-2 text-left">
      <label htmlFor={titleId} className="block text-sm font-medium text-slate-200">Título da reunião</label>
      <div className="relative">
        <input id={titleId} value={title} onChange={(event) => onTitle(event.target.value)} disabled={disabled} className={`${field} pr-14`} placeholder="Ex.: Revisão do orçamento" />
        <button type="button" onClick={dictate} disabled={disabled} aria-label={listening ? "Parar ditado" : "Ditar título e participantes"} className="absolute right-0 top-0 flex h-11 w-12 items-center justify-center rounded-r-xl text-indigo-300 hover:bg-indigo-600/20 disabled:opacity-50">
          {listening ? <Square className="h-4 w-4" /> : <Mic className="h-5 w-5" />}
        </button>
      </div>
      <label htmlFor={participantsId} className="block text-sm font-medium text-slate-200">Quem está na reunião com você?</label>
      <input id={participantsId} value={participants} onChange={(event) => onParticipants(event.target.value)} disabled={disabled} className={field} placeholder="Ex.: Ana e João" />
      <p className="text-xs text-slate-400">Você pode ditar: “Revisão do orçamento, participantes Ana e João”.</p>
      {message && <p role="status" className="text-xs text-indigo-200">{message}</p>}
    </div>
  );
}
