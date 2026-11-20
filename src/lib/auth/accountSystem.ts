import { UserAccount } from "@/types/database";
import {
  saveUserAccountToIndexedDB,
  getUserAccountFromIndexedDB,
  getAllUserAccountsFromIndexedDB,
  requestPersistentBrowserStorage,
} from "@/lib/storage/indexedDbQueue";
import {
  getSupabaseClient,
  saveUserAccountToSupabase,
  fetchUserAccountFromSupabase,
  fetchAllAccountsFromSupabase,
} from "@/lib/supabase/client";
import { getStoredKey, setStoredKey, removeStoredKey } from "@/lib/storage/keysStorage";

const STORAGE_KEY_ACTIVE_ACCOUNT = "marcameet_active_account_v1";
const STORAGE_KEY_ACCOUNTS_LIST = "marcameet_accounts_registry_v1";

let currentAccountCache: UserAccount | null = null;
let isInitialized = false;
let hasTriggeredInitialCloudSync = false;
const accountListeners = new Set<(account: UserAccount | null) => void>();

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Converte qualquer string (ex: email, "m-173...", "usr_...") em um UUID v4 válido e determinístico.
 */
export function toValidUuid(input: string): string {
  const clean = (input || "").trim();
  if (UUID_REGEX.test(clean)) {
    return clean.toLowerCase();
  }

  let h1 = 0xdeadbeef ^ clean.length;
  let h2 = 0x41c6ce57 ^ clean.length;
  let h3 = 0x811c9dc5 ^ clean.length;
  let h4 = 0xc9dc5118 ^ clean.length;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
    h3 = Math.imul(h3 ^ ch, 0x01000193);
    h4 = Math.imul(h4 ^ ch, 0x5bd1e995);
  }

  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  h3 = Math.imul(h3 ^ (h3 >>> 16), 2246822507) ^ Math.imul(h4 ^ (h4 >>> 13), 3266489909);
  h4 = Math.imul(h4 ^ (h4 >>> 16), 2246822507) ^ Math.imul(h3 ^ (h3 >>> 13), 3266489909);

  const hex1 = (h1 >>> 0).toString(16).padStart(8, "0");
  const hex2 = (h2 >>> 0).toString(16).padStart(8, "0");
  const hex3 = (h3 >>> 0).toString(16).padStart(8, "0");
  const hex4 = (h4 >>> 0).toString(16).padStart(8, "0");

  return `${hex1}-${hex2.slice(0, 4)}-4${hex2.slice(5, 8)}-8${hex3.slice(1, 4)}-${hex3.slice(4, 8)}${hex4}`;
}

export function generateUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return toValidUuid(`mm_${Date.now()}_${Math.random().toString(36).slice(2)}`);
}

export function generateDeterministicUserId(email: string): string {
  return toValidUuid(`marcameet_user:${email.trim().toLowerCase()}`);
}

export function hashAccountPassword(email: string, password: string): string {
  const payload = `marcameet_salt_v1:${email.trim().toLowerCase()}:${password}`;
  let h1 = 0x811c9dc5;
  let h2 = 0xc9dc5118;
  for (let i = 0; i < payload.length; i++) {
    const c = payload.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= c;
    h2 = Math.imul(h2, 0x5bd1e995);
  }
  return `mmh_${(h1 >>> 0).toString(16).padStart(8, "0")}_${(h2 >>> 0).toString(16).padStart(8, "0")}`;
}

function notifyAccountListeners(account: UserAccount | null) {
  accountListeners.forEach((cb) => {
    try {
      cb(account);
    } catch (e) {}
  });
}

export function subscribeAccountChange(callback: (account: UserAccount | null) => void): () => void {
  accountListeners.add(callback);
  return () => {
    accountListeners.delete(callback);
  };
}

function getLocalAccountsRegistry(): Record<string, UserAccount> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY_ACCOUNTS_LIST);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch (e) {}
  return {};
}

export function hasKnownDeviceAccounts(): boolean {
  return Object.keys(getLocalAccountsRegistry()).length > 0;
}

function saveToLocalAccountsRegistry(account: UserAccount) {
  if (typeof window === "undefined" || !account?.email) return;
  try {
    const registry = getLocalAccountsRegistry();
    const cleanEmail = account.email.trim().toLowerCase();
    const existing = registry[cleanEmail];
    const autoDefaultName = cleanEmail
      .split("@")[0]
      .replace(/[._-]+/g, " ")
      .replace(/\b\w/g, (l) => l.toUpperCase());

    const bestName =
      existing?.name && existing.name !== autoDefaultName && account.name === autoDefaultName
        ? existing.name
        : account.name || existing?.name || cleanEmail.split("@")[0];

    const merged: UserAccount = {
      ...(existing || {}),
      ...account,
      name: bestName,
      id: generateDeterministicUserId(cleanEmail),
      email: cleanEmail,
    };

    registry[cleanEmail] = merged;
    localStorage.setItem(STORAGE_KEY_ACCOUNTS_LIST, JSON.stringify(registry));

    if (currentAccountCache && currentAccountCache.email.trim().toLowerCase() === cleanEmail) {
      if (currentAccountCache.name !== merged.name) {
        currentAccountCache = merged;
        setStoredKey(STORAGE_KEY_ACTIVE_ACCOUNT, JSON.stringify(merged));
        notifyAccountListeners(merged);
      }
    }
  } catch (e) {}
  saveUserAccountToIndexedDB(account).catch(() => {});
}

/**
 * Sincroniza contas e chaves de configuração entre dispositivos via /api/cloud-sync e Supabase
 */
export async function syncAccountsAndKeysWithCloud(accountToPush?: UserAccount | null): Promise<UserAccount[]> {
  if (typeof window === "undefined") return [];

  const localRegistry = getLocalAccountsRegistry();
  const localAccounts = Object.values(localRegistry);
  if (accountToPush) {
    localAccounts.push(accountToPush);
  }

  // 1. Sincronizar com a rota de nuvem /api/cloud-sync (compartilha chaves e contas entre dispositivos)
  try {
    const supaUrl = getStoredKey("supa_url", "https://xuooojiaslhwaejsgjxh.supabase.co");
    const supaAnonKey = getStoredKey("supa_anon_key");
    const openaiKey = getStoredKey("ai_openai_key");
    const geminiKey = getStoredKey("ai_gemini_key");
    const groqKey = getStoredKey("ai_groq_key");

    const res = await fetch("/api/cloud-sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        supa_url: supaUrl || undefined,
        supa_anon_key: supaAnonKey || undefined,
        ai_openai_key: openaiKey || undefined,
        ai_gemini_key: geminiKey || undefined,
        ai_groq_key: groqKey || undefined,
        account: accountToPush || undefined,
        accounts: localAccounts,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      if (data.supa_url && !getStoredKey("supa_url")) {
        setStoredKey("supa_url", data.supa_url);
      }
      if (data.supa_anon_key && !getStoredKey("supa_anon_key")) {
        setStoredKey("supa_anon_key", data.supa_anon_key);
      }
      if (data.ai_openai_key && !getStoredKey("ai_openai_key")) {
        setStoredKey("ai_openai_key", data.ai_openai_key);
      }
      if (data.ai_gemini_key && !getStoredKey("ai_gemini_key")) {
        setStoredKey("ai_gemini_key", data.ai_gemini_key);
      }
      if (data.ai_groq_key && !getStoredKey("ai_groq_key")) {
        setStoredKey("ai_groq_key", data.ai_groq_key);
      }

      if (Array.isArray(data.accounts)) {
        for (const acc of data.accounts) {
          if (acc?.email) {
            saveToLocalAccountsRegistry(acc);
          }
        }
      }
    }
  } catch {}

  // 2. Enviar contas locais para o Supabase e buscar todas as contas do Supabase
  try {
    for (const acc of localAccounts) {
      if (acc?.email) {
        await saveUserAccountToSupabase(acc).catch(() => {});
      }
    }

    const supaAccounts = await fetchAllAccountsFromSupabase();
    for (const acc of supaAccounts) {
      if (acc?.email) {
        saveToLocalAccountsRegistry(acc);
      }
    }
  } catch {}

  return Object.values(getLocalAccountsRegistry());
}

export function getCurrentAccount(): UserAccount | null {
  if (typeof window === "undefined") return null;

  if (isInitialized && currentAccountCache) {
    return currentAccountCache;
  }

  try {
    const raw = getStoredKey(STORAGE_KEY_ACTIVE_ACCOUNT);
    if (raw) {
      const parsed = JSON.parse(raw) as UserAccount;
      if (parsed && parsed.email && parsed.id) {
        const normalizedId = generateDeterministicUserId(parsed.email);
        if (parsed.id !== normalizedId) {
          parsed.id = normalizedId;
          setStoredKey(STORAGE_KEY_ACTIVE_ACCOUNT, JSON.stringify(parsed));
        }
        saveToLocalAccountsRegistry(parsed);
        currentAccountCache = parsed;
        isInitialized = true;

        if (!hasTriggeredInitialCloudSync) {
          hasTriggeredInitialCloudSync = true;
          syncAccountsAndKeysWithCloud(parsed).catch(() => {});
        }

        return parsed;
      }
    }
  } catch (e) {}

  if (!hasTriggeredInitialCloudSync) {
    hasTriggeredInitialCloudSync = true;
    syncAccountsAndKeysWithCloud(null).catch(() => {});
  }

  isInitialized = true;
  return currentAccountCache;
}

export function setActiveAccountSession(account: UserAccount | null): void {
  if (typeof window === "undefined") return;

  if (account) {
    account = {
      ...account,
      id: generateDeterministicUserId(account.email),
    };
  }

  currentAccountCache = account;
  isInitialized = true;

  if (account) {
    setStoredKey(STORAGE_KEY_ACTIVE_ACCOUNT, JSON.stringify(account));
    saveToLocalAccountsRegistry(account);
    requestPersistentBrowserStorage().catch(() => {});
    syncAccountsAndKeysWithCloud(account).catch(() => {});
  } else {
    removeStoredKey(STORAGE_KEY_ACTIVE_ACCOUNT);
  }

  notifyAccountListeners(account);
}

/**
 * Registra uma nova conta de usuário (ou entra caso já exista)
 */
export async function registerAccount(params: {
  name: string;
  email: string;
  password: string;
  company?: string;
}): Promise<{ success: boolean; account?: UserAccount; error?: string }> {
  const cleanName = params.name.trim();
  const cleanEmail = params.email.trim().toLowerCase();
  const password = params.password;

  if (!cleanName) {
    return { success: false, error: "Por favor, informe seu nome." };
  }
  if (!cleanEmail || !cleanEmail.includes("@")) {
    return { success: false, error: "Por favor, informe um e-mail válido." };
  }
  if (!password || password.length < 4) {
    return { success: false, error: "A senha deve ter pelo menos 4 caracteres." };
  }

  await syncAccountsAndKeysWithCloud();

  const registry = getLocalAccountsRegistry();
  let existing: UserAccount | null | undefined =
    registry[cleanEmail] || (await getUserAccountFromIndexedDB(cleanEmail));

  if (!existing) {
    existing = await fetchUserAccountFromSupabase(cleanEmail);
  }

  const passwordHash = hashAccountPassword(cleanEmail, password);

  if (existing) {
    const updatedAccount: UserAccount = {
      ...existing,
      id: generateDeterministicUserId(cleanEmail),
      name: cleanName || existing.name,
      company: params.company?.trim() || existing.company,
      password_hash: passwordHash,
      updated_at: new Date().toISOString(),
      last_login_at: new Date().toISOString(),
    };
    setActiveAccountSession(updatedAccount);
    await saveUserAccountToSupabase(updatedAccount).catch(() => {});
    return { success: true, account: updatedAccount };
  }

  const now = new Date().toISOString();
  const newAccount: UserAccount = {
    id: generateDeterministicUserId(cleanEmail),
    email: cleanEmail,
    name: cleanName,
    company: params.company?.trim() || undefined,
    password_hash: passwordHash,
    created_at: now,
    updated_at: now,
    last_login_at: now,
  };

  const supa = getSupabaseClient();
  if (supa) {
    supa.auth
      .signUp({
        email: cleanEmail,
        password: password.length >= 6 ? password : `${password}_mm`,
        options: {
          data: {
            name: cleanName,
            company: params.company?.trim() || null,
          },
        },
      })
      .catch(() => {});
  }

  setActiveAccountSession(newAccount);
  await saveUserAccountToSupabase(newAccount).catch(() => {});

  return { success: true, account: newAccount };
}

/**
 * Realiza login buscando na nuvem (Supabase + /api/cloud-sync), IndexedDB e registro local.
 * Caso a conta tenha sido criada em outro aparelho antes da sincronização, vincula e ativa automaticamente pelo e-mail.
 */
export async function loginAccount(params: {
  email: string;
  password: string;
}): Promise<{ success: boolean; account?: UserAccount; error?: string }> {
  const cleanEmail = params.email.trim().toLowerCase();
  const password = params.password;

  if (!cleanEmail || !cleanEmail.includes("@")) {
    return { success: false, error: "Informe um endereço de e-mail válido." };
  }
  if (!password) {
    return { success: false, error: "Informe sua senha." };
  }

  const passwordHash = hashAccountPassword(cleanEmail, password);

  // 1. Sincronizar com a nuvem (/api/cloud-sync + Supabase) antes de verificar
  await syncAccountsAndKeysWithCloud();

  // 2. Buscar no Supabase, no registro local e no IndexedDB
  let account: UserAccount | null = await fetchUserAccountFromSupabase(cleanEmail);
  if (!account) {
    const registry = getLocalAccountsRegistry();
    account = registry[cleanEmail] || (await getUserAccountFromIndexedDB(cleanEmail));
  }

  if (account) {
    if (account.password_hash && account.password_hash !== passwordHash) {
      return {
        success: false,
        error: "Senha incorreta para este e-mail. Use o ícone de olho para conferir a senha ou clique na aba 'Redefinir Senha'.",
      };
    }

    const updated: UserAccount = {
      ...account,
      id: generateDeterministicUserId(cleanEmail),
      password_hash: account.password_hash || passwordHash,
      last_login_at: new Date().toISOString(),
    };
    setActiveAccountSession(updated);
    await saveUserAccountToSupabase(updated).catch(() => {});
    return { success: true, account: updated };
  }

  // 3. Tentar autenticar via Supabase Auth
  const supa = getSupabaseClient();
  if (supa) {
    try {
      const { data, error } = await supa.auth.signInWithPassword({
        email: cleanEmail,
        password: password.length >= 6 ? password : `${password}_mm`,
      });
      if (!error && data?.user) {
        const now = new Date().toISOString();
        const recoveredAccount: UserAccount = {
          id: generateDeterministicUserId(cleanEmail),
          email: cleanEmail,
          name: data.user.user_metadata?.name || cleanEmail.split("@")[0],
          company: data.user.user_metadata?.company || undefined,
          password_hash: passwordHash,
          created_at: data.user.created_at || now,
          updated_at: now,
          last_login_at: now,
        };
        setActiveAccountSession(recoveredAccount);
        await saveUserAccountToSupabase(recoveredAccount).catch(() => {});
        return { success: true, account: recoveredAccount };
      }
    } catch {}
  }

  // 4. Se a conta foi criada em outro dispositivo antes da sincronização em nuvem, recuperar/ativar automaticamente pelo e-mail!
  const now = new Date().toISOString();
  const defaultName = cleanEmail
    .split("@")[0]
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (l) => l.toUpperCase());

  const autoLinkedAccount: UserAccount = {
    id: generateDeterministicUserId(cleanEmail),
    email: cleanEmail,
    name: defaultName || "Usuário",
    password_hash: passwordHash,
    created_at: now,
    updated_at: now,
    last_login_at: now,
  };

  setActiveAccountSession(autoLinkedAccount);
  await saveUserAccountToSupabase(autoLinkedAccount).catch(() => {});
  return { success: true, account: autoLinkedAccount };
}

/**
 * Redefine a senha de uma conta pelo e-mail
 */
export async function resetAccountPassword(params: {
  email: string;
  newPassword: string;
}): Promise<{ success: boolean; account?: UserAccount; error?: string }> {
  const cleanEmail = params.email.trim().toLowerCase();
  if (!cleanEmail || !cleanEmail.includes("@")) {
    return { success: false, error: "Informe o e-mail da sua conta." };
  }
  if (!params.newPassword || params.newPassword.length < 4) {
    return { success: false, error: "A nova senha deve ter pelo menos 4 caracteres." };
  }

  await syncAccountsAndKeysWithCloud();

  const registry = getLocalAccountsRegistry();
  const existing: UserAccount | null =
    (await fetchUserAccountFromSupabase(cleanEmail)) ||
    registry[cleanEmail] ||
    (await getUserAccountFromIndexedDB(cleanEmail));

  const newHash = hashAccountPassword(cleanEmail, params.newPassword);
  const now = new Date().toISOString();

  const updated: UserAccount = existing
    ? {
        ...existing,
        id: generateDeterministicUserId(cleanEmail),
        password_hash: newHash,
        updated_at: now,
        last_login_at: now,
      }
    : {
        id: generateDeterministicUserId(cleanEmail),
        email: cleanEmail,
        name: cleanEmail.split("@")[0],
        password_hash: newHash,
        created_at: now,
        updated_at: now,
        last_login_at: now,
      };

  setActiveAccountSession(updated);
  await saveUserAccountToSupabase(updated).catch(() => {});
  return { success: true, account: updated };
}

/**
 * Atualiza os dados de perfil da conta ativa
 */
export async function updateAccountProfile(params: {
  name: string;
  company?: string;
}): Promise<UserAccount | null> {
  const current = getCurrentAccount();
  if (!current) return null;

  const updated: UserAccount = {
    ...current,
    id: generateDeterministicUserId(current.email),
    name: params.name.trim() || current.name,
    company: params.company?.trim() || undefined,
    updated_at: new Date().toISOString(),
  };

  setActiveAccountSession(updated);
  await saveUserAccountToSupabase(updated).catch(() => {});
  return updated;
}

/**
 * Lista todas as contas já cadastradas no site (nuvem Supabase + /api/cloud-sync + IndexedDB + LocalStorage)
 */
export async function listKnownDeviceAccounts(): Promise<UserAccount[]> {
  await syncAccountsAndKeysWithCloud();

  const registry = getLocalAccountsRegistry();
  const map = new Map<string, UserAccount>();

  Object.values(registry).forEach((acc) => {
    if (acc?.email) map.set(acc.email.toLowerCase(), acc);
  });

  const idbAccounts = await getAllUserAccountsFromIndexedDB();
  idbAccounts.forEach((acc) => {
    if (acc?.email && !map.has(acc.email.toLowerCase())) {
      map.set(acc.email.toLowerCase(), acc);
    }
  });

  return Array.from(map.values()).sort(
    (a, b) => new Date(b.last_login_at || 0).getTime() - new Date(a.last_login_at || 0).getTime()
  );
}

/**
 * Sai da conta atual mantendo todas as reuniões salvas com segurança na conta
 */
export async function logoutAccount(): Promise<void> {
  const supa = getSupabaseClient();
  if (supa) {
    supa.auth.signOut().catch(() => {});
  }
  setActiveAccountSession(null);
}
