"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Download, RefreshCw, Share2 } from "lucide-react";
import { getLocalMeetings, saveLocalMeeting, syncAccountMeetingsNow } from "@/lib/storage/mockStorage";
import type { CompleteMeetingDetails } from "@/types/database";

const placeholder = /^(?:(?:gravação|transcrição) iniciada|sem transcrição)[.!…\s]*$/i;

function getTranscriptParagraphs(transcript: CompleteMeetingDetails["transcript"]) {
  const raw = transcript?.raw_text?.trim();
  const source = raw && !placeholder.test(raw)
    ? raw
    : (transcript?.segments ?? []).map(({ text }) => text).filter((text) => text?.trim() && !placeholder.test(text.trim())).join("\n");

  const paragraphs: string[] = [];
  let paragraph = "";
  for (const line of source.split(/\n+|(?<=[.!?])\s+/)) {
    const text = line.trim();
    if (!text || placeholder.test(text)) continue;
    if (paragraph && paragraph.length + text.length > 650) {
      paragraphs.push(paragraph);
      paragraph = "";
    }
    paragraph = paragraph ? `${paragraph} ${text}` : text;
  }
  if (paragraph) paragraphs.push(paragraph);
  return paragraphs;
}

export function TranscriptPreview({ details }: { details: CompleteMeetingDetails }) {
  const viewport = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState({ top: 0, max: 0 });

  function updateScroll() {
    const box = viewport.current;
    if (!box) return;
    const top = Math.round(box.scrollTop);
    const max = Math.max(0, box.scrollHeight - box.clientHeight);
    setScroll((current) => current.top === top && current.max === max ? current : { top, max });
  }

  useEffect(() => {
    const box = viewport.current;
    if (!box) return;
    const observer = new ResizeObserver(updateScroll);
    observer.observe(box);
    if (box.firstElementChild) observer.observe(box.firstElementChild);
    updateScroll();
    return () => observer.disconnect();
  }, [details.transcript]);

  const headingId = useId();
  const [syncing, setSyncing] = useState(false);
  const [transferStatus, setTransferStatus] = useState("");
  const [recovering, setRecovering] = useState(false);
  const [recoveryStatus, setRecoveryStatus] = useState("");
  const paragraphs = useMemo(() => getTranscriptParagraphs(details.transcript), [details.transcript]);
  const { title, status } = details.meeting;
  const inProgress = ["TRANSCREVENDO", "ANALISANDO", "PROCESSANDO"].includes(status);

  const canRecover = ["recording", "online_meeting"].includes(details.meeting.source_type);

  async function recover() {
    if (!canRecover) return;
    setRecovering(true);
    setRecoveryStatus("Procurando o áudio salvo neste navegador…");
    try {
      const { recordingEngine } = await import("@/lib/audio/recordingEngine");
      const current = recordingEngine.getActiveSession();
      if (current?.meeting_id === details.meeting.id && recordingEngine.hasLiveRecorder()) {
        throw new Error("Encerre a gravação antes de recuperar a transcrição.");
      }
      const { recoverTranscript } = await import("@/lib/recording/recoverTranscript");
      const { transcript, audioDuration } = await recoverTranscript(details, (done, total) =>
        setRecoveryStatus(`Transcrevendo parte ${done} de ${total}…`));
      const latest = getLocalMeetings().find(({ meeting }) => meeting.id === details.meeting.id);
      if (!latest) throw new Error("A reunião deixou de estar disponível.");
      const oldText = getTranscriptParagraphs(latest.transcript).join(" ");
      if (transcript.raw_text.length <= oldText.length) {
        throw new Error("O áudio encontrado não produziu mais texto que a transcrição já salva.");
      }
      const durationMatches = Math.abs(audioDuration - latest.meeting.duration_seconds) <= 2;
      saveLocalMeeting({ ...latest, transcript, transcription_warning:
        durationMatches && !latest.transcription_warning?.startsWith("O microfone") ? undefined : latest.transcription_warning,
      });
      const minutes = Math.floor(audioDuration / 60);
      const seconds = Math.round(audioDuration) % 60;
      setRecoveryStatus(`Texto recuperado de ${minutes} min ${seconds} s de áudio disponível. Se a duração for menor que a reunião, parte da gravação não está neste navegador.`);
    } catch (error) {
      setRecoveryStatus(error instanceof Error ? error.message : "Não foi possível recuperar a transcrição.");
    } finally {
      setRecovering(false);
    }
  }

  function transcriptFile() {
    const filename = title.replace(/[<>:"/\\|?*\x00-\x1f]/g, "-").trim().slice(0, 120);
    return new File(["\uFEFF", title, "\n\n", paragraphs.join("\n\n"), "\n"],
      `Transcrição - ${filename || "Reunião"}.txt`, { type: "text/plain;charset=utf-8" });
  }

  async function syncTranscript() {
    setSyncing(true);
    setTransferStatus("Sincronizando reuniões…");
    try {
      const result = await syncAccountMeetingsNow();
      const meeting = getLocalMeetings().find((item) => item.meeting.id === details.meeting.id);
      const hasText = getTranscriptParagraphs(meeting?.transcript).length > 0;
      setTransferStatus(!result.syncedCloud
        ? "Não foi possível conectar à sincronização. Tente novamente."
        : hasText
          ? "Sincronização consultada. Confira o texto disponível abaixo."
          : "A transcrição ainda não chegou a este aparelho. Abra a mesma reunião no celular e toque em Sincronizar transcrição.");
    } catch {
      setTransferStatus("Não foi possível concluir a sincronização. Tente novamente.");
    } finally {
      setSyncing(false);
    }
  }

  async function shareTranscript() {
    const data = { files: [transcriptFile()] };
    if (!navigator.canShare?.(data)) {
      downloadTranscript(data.files[0]);
      setTransferStatus("O arquivo foi baixado. Você pode enviá-lo ao computador pelo aplicativo de sua escolha.");
      return;
    }
    try {
      await navigator.share(data);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setTransferStatus("Não foi possível abrir o compartilhamento. Use Baixar transcrição.");
      }
    }
  }

  function downloadTranscript(file = transcriptFile()) {
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <section aria-labelledby={headingId} className="space-y-3 rounded-3xl glass-card border border-slate-800 p-4 pb-2 sm:p-6 sm:pb-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={headingId} className="text-lg font-semibold text-slate-100">Transcrição da reunião</h2>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void syncTranscript()} disabled={syncing} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-indigo-400/50 px-3 text-sm font-semibold text-indigo-200 disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${syncing ? "motion-safe:animate-spin" : ""}`} aria-hidden="true" />
            Sincronizar transcrição
          </button>
          {paragraphs.length > 0 && (
            <>
              <button type="button" onClick={() => void shareTranscript()} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-indigo-400/50 px-3 text-sm font-semibold text-indigo-200">
                <Share2 className="h-4 w-4" aria-hidden="true" />
                Compartilhar transcrição
              </button>
              <button type="button" onClick={() => downloadTranscript()} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-indigo-600 px-3 text-sm font-semibold text-white hover:bg-indigo-500">
                <Download className="h-4 w-4" aria-hidden="true" />
                Baixar transcrição
              </button>
            </>
          )}
        </div>
      </div>
      {transferStatus && <p role="status" className="text-sm text-slate-200">{transferStatus}</p>}
      {details.transcription_warning && <p role="status" className="text-sm text-amber-200">{details.transcription_warning}</p>}
      {canRecover && (
        <details className="rounded-xl border border-slate-800 p-3">
          <summary className="cursor-pointer text-sm font-semibold text-indigo-200">Falta parte da conversa?</summary>
          <p className="my-2 text-xs leading-relaxed text-slate-300">
            No aparelho em que gravou, você pode transcrever novamente o áudio original que ainda estiver salvo. Ao clicar, o áudio será enviado em partes à OpenAI usando a chave da sua conta.
          </p>
          <button type="button" disabled={recovering} onClick={() => void recover()} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-indigo-400/50 px-3 text-sm text-indigo-200 disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${recovering ? "motion-safe:animate-spin" : ""}`} aria-hidden="true" />
            Recuperar transcrição do áudio
          </button>
          {recoveryStatus && <p role="status" className="mt-2 text-sm text-slate-200">{recoveryStatus}</p>}
        </details>
      )}
      <div className="relative rounded-xl border border-slate-200 bg-white">
        <div ref={viewport} onScroll={updateScroll} role="region" aria-label="Leitura da transcrição" tabIndex={0}
          className="max-h-[22rem] min-h-36 overflow-y-auto rounded-xl bg-white p-4 pr-12 text-slate-900 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 sm:max-h-[26rem] sm:pl-7">
          {paragraphs.length > 0 ? (
            <div className="space-y-4 break-words text-sm leading-7 sm:text-base">
              {paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
            </div>
          ) : (
            <p className="text-sm text-slate-600">
              {inProgress ? "Nenhum texto foi salvo ainda. A transcrição aparecerá aqui à medida que for salva." : "Esta reunião ainda não tem transcrição para leitura ou download."}
            </p>
          )}
        </div>
        {scroll.max > 0 && (
          <input type="range" aria-label="Rolar transcrição" aria-orientation="vertical"
            min={0} max={scroll.max} step={1} value={scroll.top}
            onChange={(event) => { if (viewport.current) viewport.current.scrollTop = Number(event.target.value); }}
            className="absolute right-2 top-2 h-[calc(100%_-_1rem)] w-6 cursor-ns-resize accent-indigo-600 [direction:ltr] [writing-mode:vertical-lr]" />
        )}
      </div>
    </section>
  );
}
