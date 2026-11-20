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

  if (accountToPush) saveToLocalAccountsRegistry(accountToPush);

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
    if (!existing.password_hash || existing.password_hash !== passwordHash) {
      return { success: false, error: "Já existe uma conta com este e-mail. Entre com a senha atual." };
    }
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

  return { success: false, error: "Conta não encontrada neste aparelho. Confira seu e-mail ou use o acesso verificado em Minhas Reuniões." };
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

  const verifiedClient = (await import("@/lib/supabase/meetingAccess")).meetingAccessClient;
  const verified = verifiedClient ? (await verifiedClient.auth.getUser()).data.user : null;
  if (!verified?.email_confirmed_at || verified.email?.toLowerCase() !== cleanEmail) {
    return { success: false, error: "Confirme seu e-mail em Minhas Reuniões antes de redefinir a senha neste aparelho." };
  }

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
  const verifiedClient = (await import("@/lib/supabase/meetingAccess")).meetingAccessClient;
  await verifiedClient?.auth.signOut({ scope: "local" }).catch(() => {});
  setActiveAccountSession(null);
}
