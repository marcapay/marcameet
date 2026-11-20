/**
 * Gerenciador de Screen Wake Lock API para Gravação de Reuniões
 * - Mantém a tela do celular (Android Chrome / iOS Safari 16.4+) ligada enquanto a gravação estiver ativa.
 * - Monitora eventos 'release' e 'visibilitychange' para reativar automaticamente quando a página voltar a ficar visível.
 * - Libera recursos imediatamente ao finalizar ou cancelar a gravação para evitar consumo desnecessário de bateria.
 */

export type WakeLockStatus = "idle" | "active" | "released" | "unsupported" | "denied";

export interface WakeLockStateInfo {
  status: WakeLockStatus;
  message: string | null;
  isSupported: boolean;
}

let wakeLockSentinel: any = null;
let pendingRequestPromise: Promise<WakeLockStateInfo> | null = null;
let shouldKeepWakeLock = false;
let globalListenersInitialized = false;

let currentState: WakeLockStateInfo = {
  status: "idle",
  message: null,
  isSupported: true,
};

const wakeLockListeners = new Set<(info: WakeLockStateInfo) => void>();

function updateWakeLockState(next: WakeLockStateInfo) {
  currentState = next;
  wakeLockListeners.forEach((cb) => {
    try {
      cb(currentState);
    } catch {}
  });
}

export function getWakeLockState(): WakeLockStateInfo {
  return currentState;
}

export function subscribeWakeLockState(callback: (info: WakeLockStateInfo) => void): () => void {
  wakeLockListeners.add(callback);
  callback(currentState);
  return () => {
    wakeLockListeners.delete(callback);
  };
}

export function isScreenWakeLockSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    "wakeLock" in navigator &&
    typeof (navigator as any).wakeLock?.request === "function"
  );
}

function initWakeLockVisibilityListeners() {
  if (globalListenersInitialized || typeof window === "undefined" || typeof document === "undefined") {
    return;
  }
  globalListenersInitialized = true;

  const handleVisibilityOrFocus = () => {
    if (
      shouldKeepWakeLock &&
      document.visibilityState === "visible" &&
      (!wakeLockSentinel || wakeLockSentinel.released)
    ) {
      void requestScreenWakeLock();
    }
  };

  document.addEventListener("visibilitychange", handleVisibilityOrFocus);
  window.addEventListener("focus", handleVisibilityOrFocus);
}

/**
 * Solicita o Screen Wake Lock ('screen') para manter a tela ligada durante a gravação.
 * Nunca interrompe a gravação caso o navegador não suporte ou recuse a solicitação.
 */
export async function requestScreenWakeLock(): Promise<WakeLockStateInfo> {
  if (typeof window === "undefined") {
    return currentState;
  }

  initWakeLockVisibilityListeners();
  shouldKeepWakeLock = true;

  if (!isScreenWakeLockSupported()) {
    const unsupportedInfo: WakeLockStateInfo = {
      status: "unsupported",
      message:
        "Seu navegador não suporta manter a tela ativa automaticamente. Mantenha a página aberta e a tela ligada durante a gravação.",
      isSupported: false,
    };
    updateWakeLockState(unsupportedInfo);
    return unsupportedInfo;
  }

  // Evitar múltiplas requisições simultâneas ou vazamento de sentinels
  if (wakeLockSentinel && !wakeLockSentinel.released) {
    const activeInfo: WakeLockStateInfo = {
      status: "active",
      message: "Tela ativa durante a gravação",
      isSupported: true,
    };
    updateWakeLockState(activeInfo);
    return activeInfo;
  }

  if (pendingRequestPromise) {
    return pendingRequestPromise;
  }

  if (typeof document !== "undefined" && document.visibilityState !== "visible") {
    const waitingInfo: WakeLockStateInfo = {
      status: "released",
      message: "A tela só pode ser mantida ligada enquanto esta página estiver visível.",
      isSupported: true,
    };
    updateWakeLockState(waitingInfo);
    return waitingInfo;
  }

  pendingRequestPromise = (async () => {
    try {
      const sentinel = await (navigator as any).wakeLock.request("screen");

      // Se a gravação foi encerrada enquanto aguardava a promessa, libera imediatamente
      if (!shouldKeepWakeLock) {
        try {
          await sentinel.release();
        } catch {}
        const idleInfo: WakeLockStateInfo = { status: "idle", message: null, isSupported: true };
        updateWakeLockState(idleInfo);
        return idleInfo;
      }

      wakeLockSentinel = sentinel;

      sentinel.addEventListener(
        "release",
        () => {
          if (wakeLockSentinel === sentinel) {
            wakeLockSentinel = null;
          }
          if (shouldKeepWakeLock) {
            updateWakeLockState({
              status: "released",
              message: "Proteção de tela pausada temporariamente. Mantenha a página visível.",
              isSupported: true,
            });
            // Se a página ainda estiver visível (ex: liberação temporária do sistema), tentar reativar
            if (typeof document !== "undefined" && document.visibilityState === "visible") {
              setTimeout(() => {
                if (shouldKeepWakeLock && (!wakeLockSentinel || wakeLockSentinel.released)) {
                  void requestScreenWakeLock();
                }
              }, 400);
            }
          } else {
            updateWakeLockState({ status: "idle", message: null, isSupported: true });
          }
        },
        { once: true }
      );

      const activeInfo: WakeLockStateInfo = {
        status: "active",
        message: "Tela ativa durante a gravação",
        isSupported: true,
      };
      updateWakeLockState(activeInfo);
      return activeInfo;
    } catch (err: any) {
      console.warn("[WakeLock] Solicitação recusada ou indisponível:", err?.message || err);
      const deniedInfo: WakeLockStateInfo = {
        status: "denied",
        message:
          "Não foi possível manter a tela ligada automaticamente (economia de bateria ou restrição do aparelho). A gravação continua normalmente — mantenha a página aberta e a tela ativa.",
        isSupported: true,
      };
      updateWakeLockState(deniedInfo);
      return deniedInfo;
    } finally {
      pendingRequestPromise = null;
    }
  })();

  return pendingRequestPromise;
}

/**
 * Libera o Screen Wake Lock quando a gravação é finalizada ou cancelada.
 */
export async function releaseScreenWakeLock(): Promise<void> {
  shouldKeepWakeLock = false;
  pendingRequestPromise = null;

  if (wakeLockSentinel) {
    const sentinelToRelease = wakeLockSentinel;
    wakeLockSentinel = null;
    try {
      if (!sentinelToRelease.released) {
        await sentinelToRelease.release();
      }
    } catch {
      // Ignorar erros na liberação
    }
  }

  updateWakeLockState({
    status: "idle",
    message: null,
    isSupported: isScreenWakeLockSupported(),
  });
}

/**
 * Funções mantidas por compatibilidade de importação sem gerar consumo desnecessário de bateria
 */
export function startAudioKeepAlive(): void {
  // Desativado loop de oscilador/áudio desnecessário para economizar bateria (Requisito 8)
}

export function stopAudioKeepAlive(): void {
  // Nada a limpar
}

export async function enableBackgroundMode(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  localStorage.setItem("marcameet_bg_mode", "enabled");
  return true;
}

export function isBackgroundModeEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem("marcameet_bg_mode") === "enabled";
}

/**
 * Atualiza a MediaSession API e o título da aba nos navegadores suportados (Chrome, Edge, Safari)
 * para auxiliar o gerenciamento de sessão ativa em segundo plano e informar o status real.
 */
let originalDocumentTitle: string | null = null;

export function updateBrowserBackgroundSessionIndicator(params: {
  title: string;
  visualState: "recording" | "paused" | "interrupted" | "syncing" | "saved" | "idle";
  elapsedFormatted?: string;
  onPause?: () => void;
  onResume?: () => void;
}): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;

  if (originalDocumentTitle === null) {
    originalDocumentTitle = document.title || "Marca Meet — Inteligência de Reuniões";
  }

  const timePrefix = params.elapsedFormatted ? `(${params.elapsedFormatted}) ` : "";
  switch (params.visualState) {
    case "recording":
      document.title = `🔴 ${timePrefix}Gravando — ${params.title}`;
      break;
    case "paused":
      document.title = `⏸️ ${timePrefix}Pausado — ${params.title}`;
      break;
    case "interrupted":
      document.title = `⚠️ Captura interrompida — ${params.title}`;
      break;
    case "syncing":
      document.title = `☁️ Sincronizando áudio — ${params.title}`;
      break;
    case "saved":
      document.title = `✅ Gravação salva — ${params.title}`;
      break;
    default:
      if (originalDocumentTitle) {
        document.title = originalDocumentTitle;
      }
      break;
  }

  if (typeof navigator !== "undefined" && "mediaSession" in navigator && typeof MediaMetadata !== "undefined") {
    try {
      const statusSubtitle =
        params.visualState === "recording"
          ? "🔴 Gravando em andamento"
          : params.visualState === "paused"
          ? "⏸️ Gravação pausada"
          : params.visualState === "interrupted"
          ? "⚠️ Captura interrompida"
          : params.visualState === "syncing"
          ? "☁️ Sincronizando áudio"
          : "✅ Gravação salva";

      navigator.mediaSession.metadata = new MediaMetadata({
        title: params.title || "Reunião Presencial",
        artist: statusSubtitle,
        album: "Marca Meet",
      });

      navigator.mediaSession.playbackState =
        params.visualState === "recording"
          ? "playing"
          : params.visualState === "paused" || params.visualState === "interrupted"
          ? "paused"
          : "none";

      if (params.onPause) {
        navigator.mediaSession.setActionHandler("pause", params.onPause);
      }
      if (params.onResume) {
        navigator.mediaSession.setActionHandler("play", params.onResume);
      }
    } catch {}
  }
}

export function clearBrowserBackgroundSessionIndicator(): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (originalDocumentTitle) {
    document.title = originalDocumentTitle;
  }
  if (typeof navigator !== "undefined" && "mediaSession" in navigator) {
    try {
      navigator.mediaSession.playbackState = "none";
      navigator.mediaSession.metadata = null;
    } catch {}
  }
}
