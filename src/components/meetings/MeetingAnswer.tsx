"use client";

import { useState } from "react";
import { Copy, Download } from "lucide-react";

type Chart = { title: string; unit: string; points: { label: string; value: number }[] };

function readChart(source: string): Chart | null {
  try {
    const { title, unit, points } = JSON.parse(source);
    if (typeof title !== "string" || typeof unit !== "string" || !Array.isArray(points) ||
        points.length < 1 || points.length > 12 ||
        !points.every((point) => point && typeof point.label === "string" && Number.isFinite(point.value))) return null;
    return { title, unit, points };
  } catch {
    return null;
  }
}

function download(name: string, content: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character] || character);
}

export function MeetingAnswer({ content, title }: { content: string; title: string }) {
  const [copyStatus, setCopyStatus] = useState("");
  const chartBlock = content.match(/```meeting-chart\s*([\s\S]*?)```/);
  const chart = chartBlock ? readChart(chartBlock[1]) : null;
  const text = content.replace(/```meeting-chart\s*[\s\S]*?```/g, "").trim();
  const slides = [...text.matchAll(/^##\s+Slide\s+\d+\s*[:–-]?\s*(.*)\r?\n([\s\S]*?)(?=^##\s+Slide\s+\d+|$(?![\s\S]))/gim)];
  const values = chart?.points.map(({ value }) => value) || [];
  const minValue = Math.min(0, ...values);
  const maxValue = Math.max(0, ...values);
  const range = maxValue - minValue || 1;
  const zero = -minValue / range * 100;
  const chartText = chart ? `\n\n${chart.title}\n${chart.points.map(({ label, value }) => `- ${label}: ${value} ${chart.unit}`).join("\n")}` : "";
  const exportText = `${text}${chartText}`;

  return (
    <div className="space-y-3">
      {text && <p className="whitespace-pre-wrap break-words text-slate-100">{text}</p>}
      {chart && (
        <figure className="space-y-2 rounded-xl border border-slate-700 p-3">
          <figcaption className="font-medium">{chart.title}</figcaption>
          <div className="space-y-2">
            {chart.points.map(({ label, value }, index) => (
              <div key={index} className="space-y-1">
                <div className="flex justify-between gap-2 text-xs">
                  <span className="break-all">{label}</span>
                  <span className="shrink-0">{value.toLocaleString("pt-BR")} {chart.unit}</span>
                </div>
                <div aria-hidden="true" className="relative h-1.5 rounded bg-slate-800">
                  <div className={`absolute h-full rounded ${value < 0 ? "bg-amber-300" : "bg-sky-400"}`}
                    style={{ left: `${zero + Math.min(value, 0) / range * 100}%`, width: `${Math.abs(value) / range * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </figure>
      )}
      <div className="flex flex-wrap gap-2 text-xs text-indigo-200">
        <button type="button" className="inline-flex min-h-11 items-center gap-1 px-2 hover:underline" onClick={async () => {
          try {
            await navigator.clipboard.writeText(exportText);
            setCopyStatus("Copiado.");
          } catch {
            setCopyStatus("Não foi possível copiar.");
          }
        }}><Copy className="h-3.5 w-3.5" /> Copiar</button>
        <button type="button" className="inline-flex min-h-11 items-center gap-1 px-2 hover:underline"
          onClick={() => download("marca-meet.md", `# ${title}\n\n${exportText}`, "text/markdown;charset=utf-8")}>
          <Download className="h-3.5 w-3.5" /> Baixar texto
        </button>
        {slides.length > 0 && (
          <button type="button" className="min-h-11 px-2 hover:underline" onClick={() => {
            const pages = slides.map(([, heading, body]) => `<section><h2>${escapeHtml(heading || title)}</h2><p>${escapeHtml(body.trim())}</p></section>`).join("");
            download("apresentacao-marca-meet.html", `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)}</title><style>html{scroll-snap-type:y proximity}body{margin:0;font:clamp(18px,3vw,32px)/1.45 system-ui;background:#12223a;color:#f1f5f9}section{box-sizing:border-box;min-height:100svh;display:grid;align-content:center;padding:8vw;scroll-snap-align:start;border-bottom:1px solid #3b5376}p{white-space:pre-wrap}h2{color:#a4ccff}@media print{section{break-after:page}}</style><body>${pages}</body></html>`, "text/html;charset=utf-8");
          }}>Baixar apresentação</button>
        )}
        {copyStatus && <span role="status" className="self-center">{copyStatus}</span>}
      </div>
    </div>
  );
}
