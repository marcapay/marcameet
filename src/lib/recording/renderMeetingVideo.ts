export interface VideoScene {
  heading: string;
  body: string;
}

export async function renderMeetingVideo(scenes: VideoScene[]): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;
  const drawingContext = canvas.getContext("2d");
  if (!drawingContext || !canvas.captureStream || typeof MediaRecorder === "undefined") {
    throw new Error("Este navegador não oferece exportação de vídeo.");
  }

  const context = drawingContext;
  const drawText = (text: string, y: number, lineHeight: number) => {
    let line = "";
    for (const word of text.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (line && context.measureText(next).width > 1056) {
        context.fillText(line, 112, y, 1056);
        y += lineHeight;
        line = word;
      } else {
        line = next;
      }
    }
    context.fillText(line, 112, y, 1056);
    return y;
  };

  function draw(scene: VideoScene, index: number) {
    context.fillStyle = "#101a30";
    context.fillRect(0, 0, 1280, 720);
    context.fillStyle = "#818cf8";
    context.fillRect(112, 105, 80, 6);
    context.font = "bold 26px sans-serif";
    context.fillText(`Marca Reuniões   •   ${index + 1}/${scenes.length}`, 112, 161);
    context.fillStyle = "#f8fafc";
    context.font = "bold 56px sans-serif";
    const headingBottom = drawText(scene.heading.slice(0, 100), 255, 64);
    context.fillStyle = "#cbd5e1";
    context.font = "40px sans-serif";
    drawText(scene.body.slice(0, 260), headingBottom + 84, 54);
  }

  draw(scenes[0], 0);
  const stream = canvas.captureStream(24);
  try {
    const mimeType = ["video/mp4", "video/webm;codecs=vp8", "video/webm"].find(
      (type) => MediaRecorder.isTypeSupported(type)
    );
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    return await new Promise<Blob>((resolve, reject) => {
      const chunks: Blob[] = [];
      let timer: ReturnType<typeof setInterval>;
      const startedAt = performance.now();
      recorder.ondataavailable = ({ data }) => {
        if (data.size) chunks.push(data);
      };
      recorder.onerror = () => {
        clearInterval(timer);
        reject(new Error("O navegador interrompeu a exportação."));
      };
      recorder.onstop = () => {
        clearInterval(timer);
        if (!chunks.length) {
          reject(new Error("O navegador não conseguiu gerar o arquivo."));
          return;
        }
        resolve(new Blob(chunks, { type: recorder.mimeType || chunks[0].type }));
      };
      recorder.start();
      timer = setInterval(() => {
        const elapsed = performance.now() - startedAt;
        const index = Math.floor(elapsed / 6000);
        if (index < scenes.length) {
          draw(scenes[index], index);
          context.fillStyle = "#818cf8";
          context.fillRect(112, 625, 1056 * ((elapsed % 6000) / 6000), 5);
        } else if (recorder.state !== "inactive") {
          recorder.stop();
        }
      }, 100);
    });
  } finally {
    stream.getTracks().forEach((track) => track.stop());
  }
}
