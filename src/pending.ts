import { config } from "./config.js";
import {
  isGithubConfigured,
  readGithubJson,
  writeGithubJson,
} from "./github.js";

export type PendingFile = {
  chatId: number;
  messageId: number;
  userId: number;
  fileId: string;
  fileName: string;
  mimeType: string;
  fileSize?: number;
  kind: string;
  createdAt: string;
};

type PendingState = {
  items: Record<string, PendingFile>;
};

function key(chatId: number, messageId: number): string {
  return `${chatId}:${messageId}`;
}

function pendingPath(): string {
  return config.github.pendingPath;
}

export async function savePending(file: PendingFile): Promise<void> {
  if (!isGithubConfigured()) return;
  const state =
    (await readGithubJson<PendingState>(pendingPath())) ?? { items: {} };
  // پاکسازی قدیمی‌تر از ۲ ساعت
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [k, v] of Object.entries(state.items)) {
    if (Date.parse(v.createdAt) < cutoff) delete state.items[k];
  }
  state.items[key(file.chatId, file.messageId)] = file;
  await writeGithubJson(
    pendingPath(),
    state,
    `pending: ${file.fileName}`,
  );
}

export async function takePending(
  chatId: number,
  messageId: number,
): Promise<PendingFile | null> {
  if (!isGithubConfigured()) return null;
  const state =
    (await readGithubJson<PendingState>(pendingPath())) ?? { items: {} };
  const k = key(chatId, messageId);
  const item = state.items[k] ?? null;
  if (item) {
    delete state.items[k];
    await writeGithubJson(pendingPath(), state, `pending: take ${k}`);
  }
  return item;
}
