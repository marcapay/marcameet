"use client";

import { useState } from "react";
import { ChevronDown, Edit2, Plus, Trash2 } from "lucide-react";
import { getLocalMeetings, saveLocalMeeting } from "@/lib/storage/mockStorage";
import type { CompleteMeetingDetails, MeetingBoardKey, MeetingTask, TaskStatus } from "@/types/database";
import { MeetingMaterials } from "./MeetingMaterials";

const boards: { key: MeetingBoardKey; title: string; color: string }[] = [
  { key: "decisions", title: "Decisões tomadas", color: "text-emerald-300" },
  { key: "highlights", title: "Pontos importantes", color: "text-purple-300" },
  { key: "tasks", title: "Tarefas mapeadas", color: "text-amber-300" },
  { key: "pending_items", title: "Pendências", color: "text-rose-300" },
  { key: "risks", title: "Riscos e alertas", color: "text-amber-300" },
  { key: "opportunities", title: "Oportunidades", color: "text-emerald-300" },
];

const statuses: TaskStatus[] = ["Pendente", "Em andamento", "Concluída", "Cancelada"];
const fieldClass = "w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100";

type BoardItem = { id: string; text: string; timestamp?: number; task?: MeetingTask };

function getItems(details: CompleteMeetingDetails, board: MeetingBoardKey): BoardItem[] {
  switch (board) {
    case "decisions": return details.decisions.map((item) => ({ id: item.id, text: item.decision_text, timestamp: item.timestamp_start }));
    case "pending_items": return details.pending_items.map((item) => ({ id: item.id, text: item.item_text, timestamp: item.timestamp_start }));
    case "tasks": return details.tasks.map((item) => ({ id: item.id, text: item.title, timestamp: item.timestamp_start, task: item }));
    default: return details[board].map((item) => ({ id: item.id, text: item.description, timestamp: item.timestamp_start }));
  }
}

function updateItem<T extends { id: string }>(items: T[], id: string, item: T): T[] {
  return items.some((current) => current.id === id)
    ? items.map((current) => current.id === id ? item : current)
    : [...items, item];
}

function MeetingBoard({ details, board, onTimestamp }: {
  details: CompleteMeetingDetails;
  board: (typeof boards)[number];
  onTimestamp: (seconds: number) => void;
}) {
  const [editing, setEditing] = useState<BoardItem | null>(null);
  const [taskDetails, setTaskDetails] = useState({ assignee: "", due: "", description: "" });
  const items = getItems(details, board.key);

  function persist(change: (current: CompleteMeetingDetails) => CompleteMeetingDetails) {
    const current = getLocalMeetings().find(({ meeting }) => meeting.id === details.meeting.id);
    if (current) saveLocalMeeting(change(current));
  }

  function edit(item: BoardItem) {
    setEditing(item);
    setTaskDetails({
      assignee: item.task?.assignee || "",
      due: item.task?.original_due_date_text || "",
      description: item.task?.description || "",
    });
  }

  function save() {
    if (!editing?.text.trim()) return;
    const { id } = editing;
    const text = editing.text.trim();
    persist((current) => {
      const base = { id, meeting_id: current.meeting.id };
      switch (board.key) {
        case "decisions": return { ...current, decisions: updateItem(current.decisions, id, { ...base, ...current.decisions.find((item) => item.id === id), decision_text: text }) };
        case "highlights": return { ...current, highlights: updateItem(current.highlights, id, { ...base, ...current.highlights.find((item) => item.id === id), description: text }) };
        case "pending_items": return { ...current, pending_items: updateItem(current.pending_items, id, { ...base, ...current.pending_items.find((item) => item.id === id), item_text: text }) };
        case "risks": return { ...current, risks: updateItem(current.risks, id, { ...base, risk_type: "outro", ...current.risks.find((item) => item.id === id), is_ai_generated: false, description: text }) };
        case "opportunities": return { ...current, opportunities: updateItem(current.opportunities, id, { ...base, category: "outro", ...current.opportunities.find((item) => item.id === id), description: text }) };
        case "tasks": return { ...current, tasks: updateItem(current.tasks, id, {
          ...base,
          user_id: current.meeting.user_id,
          status: "Pendente",
          priority: "Média",
          created_at: new Date().toISOString(),
          ...current.tasks.find((task) => task.id === id),
          title: text,
          assignee: taskDetails.assignee.trim() || "A definir",
          original_due_date_text: taskDetails.due.trim(),
          description: taskDetails.description.trim(),
        }) };
      }
    });
    setEditing(null);
  }

  return (
    <details className="group rounded-3xl glass-card border border-slate-800">
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 sm:px-6">
        <span className={`text-sm font-bold ${board.color}`}>{board.title}</span>
        <span className="flex items-center gap-2 text-xs text-slate-300">
          {items.length}
          <ChevronDown className="h-4 w-4 group-open:rotate-180" aria-hidden="true" />
        </span>
      </summary>
      <div className="space-y-3 border-t border-slate-800 p-4 sm:p-6">
        {items.length === 0 && <p className="text-sm text-slate-400">Nenhum item neste quadro.</p>}
        {items.map((item) => (
          <div key={item.id} className="rounded-xl bg-slate-900 p-3 space-y-2">
            <p className="whitespace-pre-wrap break-words text-sm text-slate-100">{item.text}</p>
            {item.task && (
              <div className="space-y-2 text-xs text-slate-300">
                {item.task.description && <p>{item.task.description}</p>}
                <p>Responsável: {item.task.assignee}</p>
                <p>Prazo: {item.task.original_due_date_text || item.task.due_date || "A definir"}</p>
                <label className="flex flex-wrap items-center gap-2">
                  Status
                  <select value={item.task.status} className="min-h-10 rounded-lg border border-slate-700 bg-slate-950 px-2"
                    onChange={(event) => {
                      const status = event.target.value as TaskStatus;
                      persist((current) => ({ ...current, tasks: current.tasks.map((task) =>
                        task.id === item.id ? { ...task, status } : task) }));
                    }}>
                    {statuses.map((status) => <option key={status}>{status}</option>)}
                  </select>
                </label>
              </div>
            )}
            <div className="flex flex-wrap gap-3 text-xs">
              {item.timestamp != null && <button type="button" className="min-h-10 text-indigo-200" onClick={() => onTimestamp(item.timestamp!)}>Ver trecho de origem</button>}
              <button type="button" onClick={() => edit(item)} className="inline-flex min-h-10 items-center gap-1 text-indigo-200"><Edit2 className="h-3.5 w-3.5" /> Editar</button>
              <button type="button" onClick={() => {
                if (!window.confirm("Excluir este item do quadro?")) return;
                persist((current) => ({ ...current, [board.key]: current[board.key].filter((entry) => entry.id !== item.id) }));
                if (editing?.id === item.id) setEditing(null);
              }} className="inline-flex min-h-10 items-center gap-1 text-rose-300"><Trash2 className="h-3.5 w-3.5" /> Excluir</button>
            </div>
          </div>
        ))}
        {editing ? (
          <form onSubmit={(event) => { event.preventDefault(); save(); }} className="space-y-2">
            <label className="block text-sm text-slate-200">
              {board.key === "tasks" ? "Título da tarefa" : "Texto do item"}
              <textarea className={fieldClass} value={editing.text} required onChange={(event) => setEditing({ ...editing, text: event.target.value })} />
            </label>
            {board.key === "tasks" && (
              <>
                <label className="block text-sm text-slate-200">Descrição da tarefa
                  <textarea className={fieldClass} value={taskDetails.description} onChange={(event) => setTaskDetails({ ...taskDetails, description: event.target.value })} />
                </label>
                <label className="block text-sm text-slate-200">Responsável
                  <input className={fieldClass} value={taskDetails.assignee} onChange={(event) => setTaskDetails({ ...taskDetails, assignee: event.target.value })} />
                </label>
                <label className="block text-sm text-slate-200">Prazo
                  <input className={fieldClass} value={taskDetails.due} onChange={(event) => setTaskDetails({ ...taskDetails, due: event.target.value })} />
                </label>
              </>
            )}
            <div className="flex gap-3">
              <button type="submit" className="min-h-11 rounded-xl bg-indigo-600 px-4 text-sm text-white">Salvar item</button>
              <button type="button" onClick={() => setEditing(null)} className="min-h-11 px-2 text-sm text-slate-300">Cancelar</button>
            </div>
          </form>
        ) : (
          <button type="button" onClick={() => edit({ id: crypto.randomUUID(), text: "" })}
            className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-indigo-200">
            <Plus className="h-4 w-4" /> Incluir item
          </button>
        )}
        <MeetingMaterials details={details} board={board.key} />
      </div>
    </details>
  );
}

export function MeetingBoards({ details, onTimestamp }: {
  details: CompleteMeetingDetails;
  onTimestamp: (seconds: number) => void;
}) {
  return (
    <div className="grid items-start gap-4 sm:grid-cols-2">
      {boards.map((board) => <MeetingBoard key={board.key} details={details} board={board} onTimestamp={onTimestamp} />)}
    </div>
  );
}
