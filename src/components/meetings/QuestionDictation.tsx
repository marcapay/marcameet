"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";

interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((event?: { error?: string }) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export function QuestionDictation({ onText, disabled, sendOnEnd = false, label: idleLabel, buttonClassName, onListening }: {
  onText: (text: string) => void;
  disabled: boolean;
  sendOnEnd?: boolean;
  label?: string;
  buttonClassName?: string;
  onListening?: (listening: boolean) => void;
}) {
  const current = useRef<Recognition | null>(null);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => () => {
    if (stopTimer.current) clearTimeout(stopTimer.current);
    const recognition = current.current;
    current.current = null;
    recognition?.abort();
  }, []);

  function toggle() {
    if (current.current) {
      if (stopTimer.current) return;
      const active = current.current;
      stopTimer.current = setTimeout(() => {
        active.onend?.();
        active.abort();
      }, 2000);
      try {
        active.stop();
      } catch {
        active.onend?.();
        active.abort();
      }
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
      if (stopTimer.current) clearTimeout(stopTimer.current);
      stopTimer.current = null;
      current.current = null;
      setListening(false);
      onListening?.(false);
    };
    let captured = "";
    recognition.lang = "pt-BR";
    recognition.continuous = sendOnEnd;
    recognition.interimResults = true;
    recognition.onresult = ({ results }) => {
      if (current.current !== recognition) return;
      const text = Array.from(results, (result) => result[0]?.transcript || "").join(" ").trim();
      if (!text) return;
      captured = text;
      setStatus(`Ouvindo… ${text}`);
    };
    recognition.onend = () => {
      if (current.current !== recognition) return;
      finish();
      if (captured) {
        setStatus(sendOnEnd ? "" : "Confira o texto ditado.");
        onText(captured);
      } else {
        setStatus("Nenhuma fala reconhecida. Tente novamente ou use o microfone do teclado.");
      }
    };
    recognition.onerror = (event) => {
      if (current.current !== recognition) return;
      if (event?.error === "no-speech" && captured) {
        recognition.onend?.();
        return;
      }
      setStatus(event?.error === "no-speech"
        ? "Nenhuma fala reconhecida. Tente novamente ou use o microfone do teclado."
        : "Ditado indisponível. Confira a permissão do microfone ou use o ditado do teclado.");
      finish();
    };
    current.current = recognition;
    setStatus(sendOnEnd ? "Ouvindo… toque novamente no microfone para enviar." : "Ouvindo…");
    setListening(true);
    onListening?.(true);
    try {
      recognition.start();
    } catch {
      recognition.onerror();
    }
  }

  const label = listening ? (sendOnEnd ? "Encerrar e enviar pergunta" : "Parar ditado") : (idleLabel ?? (sendOnEnd ? "Perguntar por voz" : "Ditar mensagem"));

  return (
    <>
      <button type="button" onClick={toggle} disabled={disabled && !listening}
        aria-label={label}
        title={label}
        className={`inline-flex min-h-11 w-11 shrink-0 items-center justify-center rounded-xl border disabled:opacity-50 ${buttonClassName ?? ""} ${
          listening
            ? "border-red-400 bg-red-600 text-white motion-safe:animate-pulse"
            : "border-emerald-500/70 bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30"
        }`}>
        {listening ? <Square className="h-4 w-4" aria-hidden="true" /> : <Mic className="h-5 w-5" aria-hidden="true" />}
      </button>
      {status && <p role="status" className="order-2 basis-full text-xs text-indigo-200">{status}</p>}
    </>
  );
}
