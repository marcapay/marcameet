const MAX_TEXT_LENGTH = 12000;

export async function readMeetingAttachment(file: File): Promise<string> {
  if (file.size > 5 * 1024 * 1024) throw new Error("Escolha um arquivo de até 5 MB.");

  let text: string;
  if (/\.(txt|csv|md)$/i.test(file.name)) {
    text = await file.text();
  } else if (/\.docx$/i.test(file.name)) {
    text = await readWord(file);
  } else if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
    text = await readPdf(file);
  } else if (/\.(jpe?g|png|webp)$/i.test(file.name) || ["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker("por");
    try {
      text = (await worker.recognize(file)).data.text;
    } finally {
      await worker.terminate();
    }
  } else {
    throw new Error("Use JPG, PNG, WebP, PDF, Word (.docx), TXT, CSV ou Markdown.");
  }

  const result = text.trim().slice(0, MAX_TEXT_LENGTH);
  if (!result) throw new Error("Não encontrei texto legível. Para PDF digitalizado, envie uma imagem da página ou um PDF com texto selecionável.");
  return result;
}

async function readPdf(file: File): Promise<string> {
  const pdf = await import("pdfjs-dist");
  // The worker module registers the in-browser PDF.js message handler.
  // @ts-expect-error PDF.js does not publish declarations for the worker module.
  await import("pdfjs-dist/build/pdf.worker.min.mjs");
  const loading = pdf.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false });
  try {
    const document = await loading.promise;
    const pages: string[] = [];
    let length = 0;
    for (let index = 1; index <= document.numPages && length < MAX_TEXT_LENGTH; index++) {
      const page = await document.getPage(index);
      const { items } = await page.getTextContent();
      const text = items.map((item) => "str" in item ? item.str : "").join(" ");
      pages.push(text);
      length += text.length;
    }
    return pages.join("\n");
  } finally {
    await loading.destroy();
  }
}

async function readWord(file: File): Promise<string> {
  const { unzipSync, strFromU8 } = await import("fflate");
  const entries = unzipSync(new Uint8Array(await file.arrayBuffer()), {
    filter: ({ name, originalSize }) => name === "word/document.xml" && originalSize <= 10 * 1024 * 1024,
  });
  const document = entries["word/document.xml"];
  if (!document) throw new Error("Não foi possível abrir o texto deste arquivo Word.");
  const xml = new DOMParser().parseFromString(strFromU8(document), "application/xml");
  const namespace = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  return Array.from(xml.getElementsByTagNameNS(namespace, "p"), (paragraph) =>
    Array.from(paragraph.getElementsByTagNameNS(namespace, "t"), (node) => node.textContent).join("")
  ).join("\n");
}
