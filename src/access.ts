import { config } from "./config.js";
import {
  isGithubConfigured,
  readGithubJson,
  writeGithubJson,
} from "./github.js";

export type AccessUser = {
  id: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  at: string;
};

export type AccessState = {
  approved: number[];
  denied: number[];
  pending: Record<string, AccessUser>;
};

const DEFAULT_STATE: AccessState = {
  approved: [],
  denied: [],
  pending: {},
};

let cache: AccessState | null = null;

function accessPath(): string {
  return config.github.accessPath;
}

export function isAdmin(userId: number | undefined): boolean {
  if (userId == null) return false;
  return config.adminUserIds.includes(userId);
}

export async function loadAccess(): Promise<AccessState> {
  if (cache) return cache;
  if (!isGithubConfigured()) {
    cache = {
      ...DEFAULT_STATE,
      approved: [...config.adminUserIds],
    };
    return cache;
  }
  const stored = await readGithubJson<AccessState>(accessPath());
  cache = {
    approved: Array.from(
      new Set([...(stored?.approved ?? []), ...config.adminUserIds]),
    ),
    denied: stored?.denied ?? [],
    pending: stored?.pending ?? {},
  };
  return cache;
}

async function saveAccess(state: AccessState, message: string): Promise<void> {
  cache = state;
  if (!isGithubConfigured()) return;
  await writeGithubJson(accessPath(), state, message);
}

export async function getAccessStatus(
  userId: number,
): Promise<"admin" | "approved" | "denied" | "pending" | "new"> {
  if (isAdmin(userId)) return "admin";
  const state = await loadAccess();
  if (state.approved.includes(userId)) return "approved";
  if (state.denied.includes(userId)) return "denied";
  if (state.pending[String(userId)]) return "pending";
  return "new";
}

export async function canUseBot(userId: number | undefined): Promise<boolean> {
  if (userId == null) return false;
  if (isAdmin(userId)) return true;
  // اگر ALLOWED_USER_IDS ست باشد، فقط همان‌ها (+ ادمین)
  if (config.allowedUserIds.length > 0) {
    return config.allowedUserIds.includes(userId);
  }
  const status = await getAccessStatus(userId);
  return status === "approved" || status === "admin";
}

export async function requestAccess(user: AccessUser): Promise<"pending" | "exists"> {
  const state = await loadAccess();
  if (
    state.approved.includes(user.id) ||
    state.denied.includes(user.id) ||
    state.pending[String(user.id)]
  ) {
    return "exists";
  }
  state.pending[String(user.id)] = user;
  await saveAccess(state, `access: pending ${user.id}`);
  return "pending";
}

export async function approveUser(userId: number): Promise<AccessUser | null> {
  const state = await loadAccess();
  const pending = state.pending[String(userId)];
  state.denied = state.denied.filter((id) => id !== userId);
  delete state.pending[String(userId)];
  if (!state.approved.includes(userId)) state.approved.push(userId);
  await saveAccess(state, `access: approve ${userId}`);
  return pending ?? { id: userId, at: new Date().toISOString() };
}

export async function denyUser(userId: number): Promise<AccessUser | null> {
  const state = await loadAccess();
  const pending = state.pending[String(userId)];
  state.approved = state.approved.filter((id) => id !== userId);
  delete state.pending[String(userId)];
  if (!state.denied.includes(userId)) state.denied.push(userId);
  await saveAccess(state, `access: deny ${userId}`);
  return pending ?? { id: userId, at: new Date().toISOString() };
}

export async function listAccessSummary(): Promise<string> {
  const state = await loadAccess();
  const pending = Object.values(state.pending);
  const lines = [
    `✅ تأییدشده: ${state.approved.length}`,
    `⏳ در انتظار: ${pending.length}`,
    `🚫 ردشده: ${state.denied.length}`,
  ];
  if (pending.length) {
    lines.push("", "در انتظار:");
    for (const u of pending.slice(0, 20)) {
      lines.push(
        `• ${u.firstName ?? ""} @${u.username ?? "—"} <code>${u.id}</code>`,
      );
    }
  }
  return lines.join("\n");
}
