"use client";

import { useId, useMemo } from "react";
import { Download } from "lucide-react";
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
  const paragraphs = useMemo(() => getTranscriptParagraphs(details.transcript), [details.transcript]);
  const { title, status } = details.meeting;
  const inProgress = ["TRANSCREVENDO", "ANALISANDO", "PROCESSANDO"].includes(status);

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
    </section>
  );
}
