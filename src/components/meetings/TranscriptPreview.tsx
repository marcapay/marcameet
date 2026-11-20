import type { CompleteMeetingDetails } from "@/types/database";

const MAX_BLOCKS = 5;
const MAX_EXCERPT = 340;
const commonWords = new Set(["ainda", "como", "deste", "entre", "esta", "este", "foram", "mais", "para", "pela", "sobre", "reuniao", "tambem", "tema", "todos", "topico"]);
const placeholder = /^(?:(?:gravacao|transcricao) iniciada|sem transcricao|nao especificado|sem conclusoes registradas)[.!…\s]*$/;

function normalize(value: string) {
  return value.toLocaleLowerCase("pt-BR").normalize("NFD").replace(/\p{M}/gu, "");
}

function hasContent(value?: string) {
  return Boolean(value?.trim() && !placeholder.test(normalize(value.trim())));
}

function shorten(value: string) {
  const text = value.trim().replace(/\s+/g, " ");
  if (text.length <= MAX_EXCERPT) return text;
  const boundary = text.lastIndexOf(" ", MAX_EXCERPT);
  return `${text.slice(0, boundary > MAX_EXCERPT / 2 ? boundary : MAX_EXCERPT)}…`;
}

export function TranscriptPreview({ details }: { details: CompleteMeetingDetails }) {
  const { transcript, summary, meeting } = details;
  const segments = (transcript?.segments ?? []).map(({ text }) => text).filter(hasContent);
  const raw = transcript?.raw_text?.trim();
  const lines = segments.length ? segments : raw && hasContent(raw)
    ? raw.split(/\n+|(?<=[.!?])\s+/).flatMap((line) => line.match(/.{1,340}(?:\s|$)|\S+/gu) ?? []).filter(hasContent)
    : [];
  const topics = [...new Set((summary?.key_topics ?? []).map((topic) => topic.trim()).filter(hasContent))].slice(0, MAX_BLOCKS);
  const normalizedLines = topics.length ? lines.map(normalize) : [];
  const used = new Set<number>();

  const blocks = topics.map((topic) => {
    const words = [...new Set((normalize(topic).match(/[a-z0-9]{4,}/g) ?? []).filter((word) => !commonWords.has(word)))];
    let bestIndex = -1;
    let bestScore = 0;
    normalizedLines.forEach((line, index) => {
      if (used.has(index)) return;
      const score = words.filter((word) => line.includes(word)).length;
      if (score > bestScore) {
        bestIndex = index;
        bestScore = score;
      }
    });
    if (bestIndex >= 0) used.add(bestIndex);
    return { title: shorten(topic), text: bestIndex < 0 ? "" : shorten(lines[bestIndex]) };
  });

  if (!blocks.length && lines.length) {
    const count = Math.min(MAX_BLOCKS, lines.length);
    for (let block = 0; block < count; block++) {
      const start = Math.floor(block * lines.length / count);
      const end = Math.floor((block + 1) * lines.length / count);
      blocks.push({ title: `Trecho ${block + 1}`, text: shorten(lines.slice(start, Math.min(start + 3, end)).join(" ")) });
    }
  }

  const overview = [summary?.objective, summary?.conclusions].filter((value): value is string => Boolean(value && hasContent(value)));
  const lists = [
    { title: "Decisões", items: details.decisions.map(({ decision_text }) => decision_text) },
    { title: "Próximos passos", items: details.next_steps_agreed?.length ? details.next_steps_agreed : details.tasks.map(({ title }) => title) },
  ].map(({ title, items }) => ({ title, items: items.filter(hasContent).slice(0, 5) })).filter(({ items }) => items.length > 0);
  const ready = blocks.length > 0 || overview.length > 0 || lists.length > 0;
  const inProgress = ["TRANSCREVENDO", "ANALISANDO", "PROCESSANDO"].includes(meeting.status);

  return (
    <section aria-label="Leitura da transcrição" className="space-y-3 rounded-3xl glass-card border border-slate-800 p-4 sm:p-6">
      <h2 className="text-lg font-semibold text-slate-100">Resumo em blocos</h2>
      {!ready ? (
        <p className="text-sm text-slate-400">
          {inProgress ? "Ainda não há texto de transcrição disponível nesta reunião. Os trechos aparecem aqui quando forem salvos." : "Esta reunião não tem transcrição nem resumo disponível para leitura."}
        </p>
      ) : (
        <>
          {overview.length > 0 && <p className="text-sm leading-relaxed text-slate-300">{overview.map(shorten).join(" ")}</p>}
          {blocks.length > 0 && (
            <>
              {lines.length > 0 && <p className="text-xs text-slate-400">{topics.length ? "Assuntos identificados e trechos relacionados disponíveis." : "Trechos da transcrição disponível, na ordem da reunião."}</p>}
              <div className="grid gap-3 sm:grid-cols-2">
                {blocks.map(({ title, text }) => (
                  <article key={title} className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 space-y-2">
                    <h3 className="break-words text-sm font-semibold text-indigo-200">{title}</h3>
                    {text && <p className="break-words text-sm leading-relaxed text-slate-300">{text}</p>}
                  </article>
                ))}
              </div>
            </>
          )}
          {lists.map(({ title, items }) => (
            <details key={title} className="rounded-xl border border-slate-800 p-3 text-sm text-slate-300">
              <summary className="cursor-pointer font-semibold text-indigo-200">{title}</summary>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {items.map((item, index) => <li key={index}>{shorten(item)}</li>)}
              </ul>
            </details>
          ))}
        </>
      )}
    </section>
  );
}
