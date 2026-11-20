/**
 * Utilitário de Armazenamento Duplo (localStorage + document.cookie com autorrecuperação)
 * Garante que as chaves de API e configurações de banco fiquem salvas para sempre no dispositivo.
 */

export const OPENAI_KEY_CHANGED = "marca-reunioes:openai-key-changed";

const keysCache = new Map<string, string>();

function getCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp("(?:^|; )" + name.replace(/([\.$?*|{}\(\)\[\]\\\/\+^])/g, "\\$1") + "=([^;]*)"));
  return match ? decodeURIComponent(match[1]) : null;
}

function setCookie(name: string, value: string, days = 3650): void {
  if (typeof document === "undefined") return;
  const maxAge = days * 24 * 60 * 60;
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}; SameSite=Lax`;
}

export function getStoredKey(key: string, envFallback = ""): string {
  if (typeof window === "undefined") {
    return (envFallback.includes("placeholder") ? "" : envFallback).trim();
  }

  const cacheKey = `${key}_${envFallback}`;
  if (keysCache.has(cacheKey)) {
    return keysCache.get(cacheKey)!;
  }

  // 1. Tentar ler do localStorage
  let val = localStorage.getItem(key) || "";

  // 2. Se não estiver no localStorage, tentar recuperar do Cookie de longa duração
  if (!val.trim()) {
    const cookieVal = getCookie(key);
    if (cookieVal && cookieVal.trim()) {
      val = cookieVal.trim();
      // Autorrecuperação: Restaurar de volta no localStorage
      try {
        localStorage.setItem(key, val);
      } catch (e) {
        console.warn("Erro ao autorrecuperar chave no localStorage:", e);
      }
    }
  } else {
    // Garantir que o cookie também permaneça atualizado
    setCookie(key, val);
  }

  // 3. Fallback para variável de ambiente se a chave armazenada ainda estiver vazia
  if (!val.trim() && envFallback) {
    val = envFallback;
  }

  const result = val.includes("placeholder") ? "" : val.trim();
  keysCache.set(cacheKey, result);
  return result;
}

export function setStoredKey(key: string, value: string): void {
  if (typeof window === "undefined") return;

  const trimmed = value.trim();
  keysCache.clear(); // Limpa cache para garantir atualização de todas variantes

  try {
    localStorage.setItem(key, trimmed);
  } catch (e) {
    console.warn("Erro ao salvar no localStorage:", e);
  }

  setCookie(key, trimmed);
  if (key === "ai_openai_key") window.dispatchEvent(new Event(OPENAI_KEY_CHANGED));
}

export function removeStoredKey(key: string): void {
  if (typeof window === "undefined") return;

  keysCache.clear();

  try {
    localStorage.removeItem(key);
  } catch (e) {
    console.warn("Erro ao remover do localStorage:", e);
  }

  if (typeof document !== "undefined") {
    document.cookie = `${key}=; path=/; max-age=0; SameSite=Lax`;
  }
  if (key === "ai_openai_key") window.dispatchEvent(new Event(OPENAI_KEY_CHANGED));
}

