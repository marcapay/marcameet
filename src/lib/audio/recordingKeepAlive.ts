/**
 * Utilitário para Manter Gravações Longas Ativas em Segundo Plano e Tela Apagada:
 * 1. Screen Wake Lock API (Impede que a tela do celular/computador apague ou entre em repouso)
 * 2. Silent Audio Keep-Alive + HTML Audio Loop (Mantém o Web Audio Engine ativo em segundo plano no iOS Safari e Android)
 * 3. MediaSession API (Registra reprodução ativa de mídia no sistema operacional)
 */

let wakeLockSentinel: any = null;
let keepAliveAudioCtx: AudioContext | null = null;
let keepAliveOscillator: OscillatorNode | null = null;
let silentAudioEl: HTMLAudioElement | null = null;

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
 * Inicia um loop de áudio silencioso via HTMLAudioElement e MediaSession API
 * Essencial para iOS Safari e Android Chrome continuarem rodando quando a tela é bloqueada
 */
export function startSilentAudioLoop(): void {
  if (typeof window === "undefined") return;
  try {
    if (!silentAudioEl) {
      silentAudioEl = new Audio("data:audio/wav;base64,UklGRjIAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=");
      silentAudioEl.loop = true;
      silentAudioEl.volume = 0.01;
    }
    silentAudioEl.play().catch(() => {});

    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: "Marca Meet",
        artist: "Modo Segundo Plano & Tela Apagada Ativo",
        album: "Inteligência de Reuniões",
      });
    }
  } catch (e) {
    console.warn("Erro ao iniciar loop de áudio silencioso:", e);
  }
}

/**
 * Inicia um oscilador silencioso no AudioContext para evitar que navegadores mobile
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
      gain.gain.setValueAtTime(0.0001, keepAliveAudioCtx.currentTime); // Silencioso

      osc.connect(gain);
      gain.connect(keepAliveAudioCtx.destination);
      osc.start();

      keepAliveOscillator = osc;
    }

    startSilentAudioLoop();
  } catch (err) {
    console.warn("Não foi possível iniciar Audio Keep-Alive:", err);
  }
}

/**
 * Encerra o oscilador silencioso e o áudio de fundo
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
    if (silentAudioEl) {
      silentAudioEl.pause();
    }
  } catch (err) {
    console.warn("Erro ao finalizar Audio Keep-Alive:", err);
  }
}

/**
 * Ativa o modo de segundo plano completo (Wake Lock + Audio Keep Alive + MediaSession)
 */
export async function enableBackgroundMode(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  try {
    localStorage.setItem("marcameet_bg_mode", "enabled");
    await requestScreenWakeLock();
    startAudioKeepAlive();
    startSilentAudioLoop();
    return true;
  } catch (e) {
    console.warn("Erro ao ativar modo segundo plano:", e);
    return false;
  }
}

/**
 * Verifica se o modo segundo plano está ativado
 */
export function isBackgroundModeEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem("marcameet_bg_mode") === "enabled";
}
