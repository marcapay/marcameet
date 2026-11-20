"use client";

import { useId, useMemo, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import { getLocalMeetings, saveLocalMeeting } from "@/lib/storage/mockStorage";
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
  const headingId = useId();
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

  function downloadTranscript() {
    const file = new Blob(["\uFEFF", title, "\n\n", paragraphs.join("\n\n"), "\n"], {
      type: "text/plain;charset=utf-8",
    });
    const filename = title.replace(/[<>:"/\\|?*\x00-\x1f]/g, "-").trim().slice(0, 120);
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Transcrição - ${filename || "Reunião"}.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <section aria-labelledby={headingId} className="space-y-3 rounded-3xl glass-card border border-slate-800 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={headingId} className="text-lg font-semibold text-slate-100">Transcrição da reunião</h2>
        {paragraphs.length > 0 && (
          <button type="button" onClick={downloadTranscript} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-indigo-600 px-3 text-sm font-semibold text-white hover:bg-indigo-500">
            <Download className="h-4 w-4" aria-hidden="true" />
            Baixar transcrição
          </button>
        )}
      </div>
      {details.transcription_warning && <p role="status" className="text-sm text-amber-200">{details.transcription_warning}</p>}
      <div role="region" aria-label="Leitura da transcrição" tabIndex={0}
        className="max-h-[28rem] min-h-36 overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 text-slate-900 [scrollbar-gutter:stable] focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 sm:max-h-[32rem] sm:p-7">
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
    </section>
  );
}
