/**
 * Utilitário para Manter Gravações Longas Ativas com Tempo Ilimitado:
 * 1. Screen Wake Lock API (Impede que a tela do celular/computador apague ou entre em repouso)
 * 2. Silent Audio Keep-Alive (Mantém o Web Audio Engine ativo em segundo plano no iOS WebKit e Android)
 */

let wakeLockSentinel: any = null;
let keepAliveAudioCtx: AudioContext | null = null;
let keepAliveOscillator: OscillatorNode | null = null;

/**
 * Solicita a trava de tela (Screen Wake Lock) para evitar que o dispositivo hiberne
 */
export async function requestScreenWakeLock(): Promise<boolean> {
  if (typeof window === "undefined" || !("wakeLock" in navigator)) {
    return false;
  }

  try {
    if (wakeLockSentinel && !wakeLockSentinel.released) {
      return true;
    }
    wakeLockSentinel = await (navigator as any).wakeLock.request("screen");
    wakeLockSentinel.addEventListener("release", () => {
      wakeLockSentinel = null;
    });
    return true;
  } catch (err) {
    console.warn("Screen Wake Lock não pôde ser ativado:", err);
    return false;
  }
}

/**
 * Libera a trava de tela quando a gravação é encerrada ou cancelada
 */
export async function releaseScreenWakeLock(): Promise<void> {
  if (wakeLockSentinel) {
    try {
      await wakeLockSentinel.release();
    } catch (e) {
      // Ignorar erros na liberação
    }
    wakeLockSentinel = null;
  }
}

/**
 * Inicia um oscilador silencioso no AudioContext para evitar que navegadores mobile (iOS Safari/Chrome)
 * suspendam a execução do script em segundo plano durante gravações longas.
 */
export function startAudioKeepAlive(): void {
  if (typeof window === "undefined") return;

  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;

    if (!keepAliveAudioCtx || keepAliveAudioCtx.state === "closed") {
      keepAliveAudioCtx = new AudioCtx();
    }

    if (keepAliveAudioCtx.state === "suspended") {
      keepAliveAudioCtx.resume();
    }

    if (!keepAliveOscillator) {
      const osc = keepAliveAudioCtx.createOscillator();
      const gain = keepAliveAudioCtx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(440, keepAliveAudioCtx.currentTime);
      gain.gain.setValueAtTime(0.0001, keepAliveAudioCtx.currentTime); // Inaudível / Silencioso

      osc.connect(gain);
      gain.connect(keepAliveAudioCtx.destination);
      osc.start();

      keepAliveOscillator = osc;
    }
  } catch (err) {
    console.warn("Não foi possível iniciar Audio Keep-Alive:", err);
  }
}

/**
 * Encerra o oscilador silencioso ao finalizar a gravação
 */
export function stopAudioKeepAlive(): void {
  try {
    if (keepAliveOscillator) {
      keepAliveOscillator.stop();
      keepAliveOscillator.disconnect();
      keepAliveOscillator = null;
    }
    if (keepAliveAudioCtx && keepAliveAudioCtx.state !== "closed") {
      keepAliveAudioCtx.close();
      keepAliveAudioCtx = null;
    }
  } catch (err) {
    console.warn("Erro ao finalizar Audio Keep-Alive:", err);
  }
}
