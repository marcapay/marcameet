"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";

interface Recognition {
  lang: string;
  continuous: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export function QuestionDictation({ onText, disabled, sendOnEnd = false }: {
  onText: (text: string) => void;
  disabled: boolean;
  sendOnEnd?: boolean;
}) {
  const current = useRef<Recognition | null>(null);
  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => () => {
    const recognition = current.current;
    current.current = null;
    recognition?.abort();
  }, []);

  function toggle() {
    if (current.current) {
      current.current.stop();
      return;
    }
    const browser = window as Window & {
      SpeechRecognition?: new () => Recognition;
      webkitSpeechRecognition?: new () => Recognition;
    };
    const Recognizer = browser.SpeechRecognition || browser.webkitSpeechRecognition;
    if (!Recognizer) {
      setStatus("Ditado indisponível neste navegador. Digite aqui ou use o microfone do teclado do celular.");
      return;
    }
    const recognition = new Recognizer();
    const finish = () => {
      if (current.current !== recognition) return;
      current.current = null;
      setListening(false);
    };
    let captured = "";
    recognition.lang = "pt-BR";
    recognition.continuous = sendOnEnd;
    recognition.onresult = ({ results }) => {
      if (current.current !== recognition) return;
      const text = Array.from(results, (result) => result[0]?.transcript || "").join(" ").trim();
      if (sendOnEnd) {
        captured = text;
        return;
      }
      if (text) onText(text);
      setStatus(text ? "Confira a mensagem antes de enviar." : "Nenhuma fala reconhecida.");
    };
    recognition.onend = () => {
      if (current.current !== recognition) return;
      finish();
      if (sendOnEnd && captured) {
        setStatus("");
        onText(captured);
      } else {
        setStatus((value) => value.startsWith("Ouvindo…") ? "Nenhuma fala reconhecida." : value);
      }
    };
    recognition.onerror = () => {
      if (current.current !== recognition) return;
      setStatus("Ditado indisponível. Confira a permissão do microfone ou digite a mensagem.");
      finish();
    };
    current.current = recognition;
    setStatus(sendOnEnd ? "Ouvindo… toque novamente no microfone para enviar." : "Ouvindo…");
    setListening(true);
    try {
      recognition.start();
    } catch {
      recognition.onerror();
    }
  }

  const label = listening ? (sendOnEnd ? "Encerrar e enviar pergunta" : "Parar ditado") : (sendOnEnd ? "Perguntar por voz" : "Ditar mensagem");

  return (
    <>
      <button type="button" onClick={toggle} disabled={disabled && !listening}
        aria-label={label}
        title={label}
        className="inline-flex min-h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-700 text-indigo-200 hover:bg-indigo-600/20 disabled:opacity-50">
        {listening ? <Square className="h-4 w-4" aria-hidden="true" /> : <Mic className="h-5 w-5" aria-hidden="true" />}
      </button>
      {status && <p role="status" className="order-2 basis-full text-xs text-indigo-200">{status}</p>}
    </>
  );
}
