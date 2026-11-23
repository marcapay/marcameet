import type { CompleteMeetingDetails } from "@/types/database";

function transcriptText(details: CompleteMeetingDetails): string {
  const placeholder = /^(?:(?:gravação|transcrição) iniciada|sem transcrição|reunião salva na conta)[.!…\s]*$/i;
  const raw = details.transcript?.raw_text?.trim();
  if (raw && !placeholder.test(raw)) return raw;
  const segments = details.transcript?.segments;
  return Array.isArray(segments)
    ? segments.map((segment) => typeof segment?.text === "string" ? segment.text.trim() : "")
        .filter((text) => text && !placeholder.test(text)).join(" ")
    : "";
}

export function mergeMeetingEntries(a: CompleteMeetingDetails, b: CompleteMeetingDetails): CompleteMeetingDetails {
  const aTime = new Date(a.meeting.updated_at || a.meeting.meeting_date || 0).getTime();
  const bTime = new Date(b.meeting.updated_at || b.meeting.meeting_date || 0).getTime();
  const latest = bTime >= aTime ? b : a;
  const older = latest === a ? b : a;
  const analysis = latest.summary?.objective || !older.summary?.objective ? latest : older;
  const transcription = transcriptText(latest) || !transcriptText(older) ? latest : older;

  return {
    ...analysis,
    meeting: {
      ...latest.meeting,
      status: analysis.meeting.status,
      tasks_count: analysis.meeting.tasks_count,
      decisions_count: analysis.meeting.decisions_count,
      highlights_count: analysis.meeting.highlights_count,
    },
    transcript: transcription.transcript,
    transcription_warning: transcription.transcription_warning,
    support_materials: latest.support_materials ?? older.support_materials,
  };
}
