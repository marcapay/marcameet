"use client";

import { useState } from "react";
import { FileText, Paperclip, Upload } from "lucide-react";
import { getLocalMeetings, saveLocalMeeting } from "@/lib/storage/mockStorage";
import type { CompleteMeetingDetails, MeetingBoardKey, MeetingMaterial } from "@/types/database";

const MAX_MATERIALS = 10;

export function MeetingMaterials({ details, board, onOpenChat, compact = false, pickerClassName = "", hidePicker = false }: {
  details: CompleteMeetingDetails;
  board?: MeetingBoardKey;
  onOpenChat?: () => void;
  compact?: boolean;
  pickerClassName?: string;
  hidePicker?: boolean;
}) {
  const [reading, setReading] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const allMaterials = details.support_materials ?? [];
  const materials = board ? allMaterials.filter((material) => material.board === board) : allMaterials;

  async function importFiles(files: File[]) {
    setReading(true);
    const errors: string[] = [];
    const imported: MeetingMaterial[] = [];
    const remaining = MAX_MATERIALS - allMaterials.length;
    setErrors([]);
    try {
      const { readMeetingAttachment } = await import("@/lib/ai/meetingAttachment");
      for (const file of files.slice(0, remaining)) {
        try {
          imported.push({ name: file.name, board, text: await readMeetingAttachment(file) });
        } catch (error) {
          errors.push(`${file.name}: ${error instanceof Error ? error.message : "falha ao ler o arquivo"}`);
        }
      }

      if (imported.length) {
        const latest = getLocalMeetings().find(({ meeting }) => meeting.id === details.meeting.id);
        if (!latest) {
          errors.push("A reunião deixou de estar disponível durante a importação.");
        } else {
          const current = latest.support_materials ?? [];
          if (current.length + imported.length > MAX_MATERIALS) errors.push("O limite da reunião é de 10 anexos.");
          saveLocalMeeting({ ...latest, support_materials: [...current, ...imported].slice(0, MAX_MATERIALS) });
        }
      }
      if (files.length > remaining) errors.push("O limite da reunião é de 10 anexos.");
    } catch {
      errors.push("Não foi possível importar os arquivos. Tente novamente.");
    } finally {
      setErrors(errors);
      setReading(false);
    }
  }

  const filePicker = (
    <input type="file" className="sr-only" aria-label="Anexar arquivo ou foto" multiple accept=".jpg,.jpeg,.png,.webp,.pdf,.docx,.txt,.csv,.md"
          disabled={reading || allMaterials.length >= MAX_MATERIALS}
          onChange={(event) => {
            const files = Array.from(event.currentTarget.files || []);
            event.currentTarget.value = "";
            if (files.length) void importFiles(files);
          }} />
  );

  if (compact) {
    return (
      <>
        <label title="Anexar arquivo ou foto" className={`inline-flex min-h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-slate-700 text-indigo-200 hover:bg-indigo-600/20 focus-within:ring-2 focus-within:ring-indigo-300 has-[:disabled]:opacity-50 ${pickerClassName}`}>
          <Paperclip className="h-5 w-5" aria-hidden="true" />
          {filePicker}
        </label>
        {reading && <p role="status" className="order-2 basis-full text-xs text-indigo-200">Lendo os arquivos…</p>}
        {errors.length > 0 && <p role="alert" className="order-2 basis-full text-xs text-amber-200">{errors.join(" ")}</p>}
        {materials.length > 0 && <p className="order-2 basis-full truncate text-xs text-slate-400" title={materials.map(({ name }) => name).join(", ")}>{materials.length === 1 ? materials[0].name : `${materials.length} anexos nesta reunião`}</p>}
      </>
    );
  }

  return (
    <section className="rounded-3xl glass-card border border-slate-800 p-4 sm:p-8 space-y-4">
      <h2 className="text-lg font-bold text-white">Material de apoio</h2>
      <p className="text-sm text-slate-300">O navegador extrai o texto e guarda neste aparelho. Use Consultar na conversa para analisar o texto com a OpenAI configurada em Minha Conta.</p>
      {!hidePicker && (
        <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white focus-within:ring-2 focus-within:ring-indigo-300 has-[:disabled]:opacity-50">
          <Upload className="h-4 w-4" aria-hidden="true" />
          Selecionar arquivos
          {filePicker}
        </label>
      )}
      <p className="text-xs text-slate-400">JPG, PNG, WebP, PDF, Word (.docx), TXT, CSV ou Markdown. Até 5 MB por arquivo e 10 arquivos por reunião. Fotos precisam ter texto legível e PDFs precisam ter texto selecionável.</p>
      {reading && <p role="status" className="text-sm text-indigo-200">Lendo os arquivos…</p>}
      {errors.length > 0 && (
        <ul role="alert" className="space-y-1 break-words text-sm text-amber-200">
          {[...new Set(errors)].map((error) => <li key={error}>{error}</li>)}
        </ul>
      )}
      {materials.length > 0 && (
        <>
          <ul className="space-y-2">
            {materials.map((material, index) => (
              <li key={index} className="flex items-center gap-2 rounded-xl bg-slate-900 p-3 text-sm text-slate-100">
                <FileText className="h-4 w-4 shrink-0 text-indigo-300" aria-hidden="true" />
                <span className="min-w-0 flex-1 break-all">{material.name}</span>
                <button type="button" disabled={reading} className="min-h-11 shrink-0 text-xs text-rose-300"
                  onClick={() => {
                    if (!window.confirm("Excluir este anexo da reunião?")) return;
                    const current = getLocalMeetings().find(({ meeting }) => meeting.id === details.meeting.id);
                    if (!current) return;
                    const entries = current.support_materials ?? [];
                    const match = entries.findIndex(({ name, text, board }) => name === material.name && text === material.text && board === material.board);
                    if (match >= 0) saveLocalMeeting({ ...current, support_materials: entries.filter((_, index) => index !== match) });
                  }}>Excluir anexo</button>
              </li>
            ))}
          </ul>
          {onOpenChat && <button type="button" onClick={onOpenChat} className="min-h-11 text-sm font-semibold text-indigo-200 hover:underline">
            Consultar na conversa
          </button>}
        </>
      )}
    </section>
  );
}
