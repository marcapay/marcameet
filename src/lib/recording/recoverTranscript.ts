import { fetchOpenAI } from "@/lib/ai/openaiHealth";
import { getActiveApiKeys } from "@/lib/ai";
import { getMeetingAudioBlob } from "./chunkStore";
import type { CompleteMeetingDetails, Transcript } from "@/types/database";

function makeWav(audio: AudioBuffer, start: number, end: number) {
  const buffer = new ArrayBuffer(44 + (end - start) * 2);
  const view = new DataView(buffer);
  for (const [offset, label] of [[0, "RIFF"], [8, "WAVEfmt "], [36, "data"]] as const) {
    for (let i = 0; i < label.length; i++) view.setUint8(offset + i, label.charCodeAt(i));
  }
  view.setUint32(4, buffer.byteLength - 8, true);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, audio.sampleRate, true);
  view.setUint32(28, audio.sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  view.setUint32(40, buffer.byteLength - 44, true);
  const channels = Array.from({ length: audio.numberOfChannels }, (_, index) => audio.getChannelData(index));
  for (let sample = start; sample < end; sample++) {
    let total = 0;
    for (const channel of channels) total += channel[sample];
    const value = Math.max(-1, Math.min(1, total / channels.length));
    view.setInt16(44 + (sample - start) * 2, Math.round(value * 32767), true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

export async function recoverTranscript(details: CompleteMeetingDetails, onProgress: (done: number, total: number) => void): Promise<{ transcript: Transcript; audioDuration: number }> {
  const id = details.meeting.id;
  const original = await getMeetingAudioBlob(id);
  if (!original?.size) {
    throw new Error("Nenhum áudio original encontrado neste navegador. Abra a reunião no aparelho e navegador usados para gravar.");
  }
  return transcribeRecordedAudio(original, id, details.transcript?.id, details.transcript?.speaker_map, onProgress);
}

export async function transcribeRecordedAudio(
  original: Blob,
  id: string,
  existingTranscriptId?: string,
  speakerMap: Transcript["speaker_map"] = {},
  onProgress?: (done: number, total: number) => void,
): Promise<{ transcript: Transcript; audioDuration: number }> {
  const { openaiKey } = getActiveApiKeys();
  if (!openaiKey) throw new Error("Configure sua chave da OpenAI em Minha Conta para transcrever o áudio.");
  const context = new AudioContext({ sampleRate: 16000 });
  let audio: AudioBuffer;
  try {
    audio = await context.decodeAudioData(await original.arrayBuffer());
  } catch {
    throw new Error("O navegador não conseguiu abrir o áudio salvo. A transcrição atual foi preservada.");
  } finally {
    await context.close().catch(() => {});
  }

  const transcriptId = existingTranscriptId || `t-${id}`;
  const segments: NonNullable<Transcript["segments"]> = [];
  const text: string[] = [];
  const partSize = audio.sampleRate * 180;
  const total = Math.ceil(audio.length / partSize);
  for (let part = 0; part < total; part++) {
    const start = part * partSize;
    const end = Math.min(start + partSize, audio.length);
    onProgress?.(part + 1, total);
    const form = new FormData();
    form.append("file", makeWav(audio, start, end), `trecho-${part + 1}.wav`);
    form.append("model", "whisper-1");
    form.append("language", "pt");
    form.append("response_format", "verbose_json");
    form.append("temperature", "0");
    const response = await fetchOpenAI("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${openaiKey}` },
      body: form,
      signal: AbortSignal.timeout(90000),
    });
    if (!response.ok) throw new Error(`A OpenAI não conseguiu transcrever a parte ${part + 1} de ${total}. O texto que já estava salvo foi preservado.`);
    const result = await response.json() as { text?: string; segments?: { start: number; end: number; text: string }[] };
    const partText = result.text?.trim();
    if (partText) text.push(partText);
    const offset = start / audio.sampleRate;
    const partSegments = (result.segments ?? []).filter((segment) => segment.text?.trim());
    if (partText && !partSegments.length) partSegments.push({ start: 0, end: (end - start) / audio.sampleRate, text: partText });
    for (const segment of partSegments) {
      segments.push({ id: `recovered-${id}-${segments.length}`, transcript_id: transcriptId, meeting_id: id,
        start_time: offset + segment.start, end_time: offset + segment.end, speaker: "Falante não identificado", text: segment.text.trim() });
    }
  }

  const rawText = text.join("\n\n");
  if (!rawText) throw new Error("Não foi encontrada fala reconhecível no áudio salvo.");
  return {
    transcript: { id: transcriptId, meeting_id: id, raw_text: rawText, speaker_map: speakerMap, segments },
    audioDuration: audio.duration,
  };
}
