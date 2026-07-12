import { randomUUID } from "node:crypto";
import type {
  WatchNewsConfidence,
  WatchNewsHistory,
  WatchNewsMessage
} from "../shared/types";
import { JsonStore } from "./json-store";

export type WatchNewsDraft = Omit<WatchNewsMessage, "id" | "fetchedAt" | "dedupeKey" | "readAt"> & {
  fetchedAt?: string;
};

const MAX_MESSAGES = 500;

export class WatchNewsStore {
  private readonly store: JsonStore<WatchNewsHistory>;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(path: string) {
    this.store = new JsonStore(path, () => ({ version: 1, messages: [] }));
  }

  async list(secids?: string[]): Promise<WatchNewsMessage[]> {
    const history = await this.getHistory();
    const secidSet = secids && secids.length > 0 ? new Set(secids) : undefined;
    return history.messages
      .filter((message) => !secidSet || secidSet.has(message.secid))
      .sort((left, right) => right.fetchedAt.localeCompare(left.fetchedAt));
  }

  async addMessages(drafts: WatchNewsDraft[], fetchedAt: string): Promise<WatchNewsMessage[]> {
    return await this.enqueueMutation(async () => await this.addMessagesNow(drafts, fetchedAt));
  }

  async markRead(secid: string, messageIds: string[] | undefined, readAt: string): Promise<WatchNewsMessage[]> {
    return await this.enqueueMutation(async () => await this.markReadNow(secid, messageIds, readAt));
  }

  private async addMessagesNow(drafts: WatchNewsDraft[], fetchedAt: string): Promise<WatchNewsMessage[]> {
    const history = await this.getHistory();
    const messages = [...history.messages];
    const knownByKey = new Map(messages.map((message) => [message.dedupeKey, message]));
    const inserted: WatchNewsMessage[] = [];
    let upgraded = false;
    for (const draft of drafts) {
      const message = normalizeDraft(draft, fetchedAt);
      const existing = knownByKey.get(message.dedupeKey)
        ?? findPendingAnnouncementByTitle(messages, message);
      if (existing) {
        if (shouldUpgradePendingAnalysis(existing, message)) {
          const replacement: WatchNewsMessage = {
            ...message,
            id: existing.id,
            fetchedAt: existing.fetchedAt,
            dedupeKey: existing.dedupeKey,
            ...(existing.readAt ? { readAt: existing.readAt } : {})
          };
          const index = messages.findIndex((item) => item.dedupeKey === existing.dedupeKey);
          messages[index] = replacement;
          knownByKey.set(replacement.dedupeKey, replacement);
          knownByKey.set(message.dedupeKey, replacement);
          upgraded = true;
        }
        continue;
      }
      knownByKey.set(message.dedupeKey, message);
      inserted.push(message);
      messages.unshift(message);
    }
    if (inserted.length === 0 && !upgraded) {
      return [];
    }
    await this.writeMessages(messages);
    return inserted;
  }

  private async markReadNow(
    secid: string,
    messageIds: string[] | undefined,
    readAt: string
  ): Promise<WatchNewsMessage[]> {
    const ids = messageIds && messageIds.length > 0 ? new Set(messageIds) : undefined;
    const history = await this.getHistory();
    let changed = false;
    const messages = history.messages.map((message) => {
      if (message.secid !== secid || message.readAt || (ids && !ids.has(message.id))) {
        return message;
      }
      changed = true;
      return { ...message, readAt };
    });
    if (changed) {
      await this.writeMessages(messages);
    }
    return messages
      .filter((message) => message.secid === secid)
      .sort((left, right) => right.fetchedAt.localeCompare(left.fetchedAt));
  }

  private async enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation, operation);
    this.mutationQueue = result.then(() => undefined, () => undefined);
    return await result;
  }

  private async getHistory(): Promise<WatchNewsHistory> {
    try {
      return validateHistory(await this.store.read());
    } catch (error) {
      if (error instanceof Error && error.message.includes("持仓股消息")) {
        return { version: 1, messages: [] };
      }
      throw error;
    }
  }

  private async writeMessages(messages: WatchNewsMessage[]): Promise<void> {
    await this.store.write({
      version: 1,
      messages: messages
        .sort((left, right) => right.fetchedAt.localeCompare(left.fetchedAt))
        .slice(0, MAX_MESSAGES)
    });
  }
}

function shouldUpgradePendingAnalysis(
  existing: WatchNewsMessage,
  incoming: WatchNewsMessage
): boolean {
  return existing.analysis.includes("AI 分析未完成")
    && !incoming.analysis.includes("AI 分析未完成");
}

function findPendingAnnouncementByTitle(
  messages: WatchNewsMessage[],
  incoming: WatchNewsMessage
): WatchNewsMessage | undefined {
  return messages.find((message) =>
    message.secid === incoming.secid
    && normalizeText(message.title) === normalizeText(incoming.title)
    && shouldUpgradePendingAnalysis(message, incoming));
}

function normalizeDraft(draft: WatchNewsDraft, fetchedAt: string): WatchNewsMessage {
  const title = nonEmpty(draft.title, "消息标题");
  const summary = nonEmpty(draft.summary, "消息摘要");
  const sourceName = nonEmpty(draft.sourceName, "消息来源");
  const stockName = nonEmpty(draft.stockName, "股票名称");
  const secid = nonEmpty(draft.secid, "股票 secid");
  const confidence = normalizeConfidence(draft.confidence);
  const sourceUrl = optionalString(draft.sourceUrl);
  const occurredAt = optionalString(draft.occurredAt);
  const analysis = nonEmpty(draft.analysis, "分析意见");
  return {
    id: randomUUID(),
    secid,
    stockName,
    title,
    summary,
    sourceName,
    ...(sourceUrl ? { sourceUrl } : {}),
    ...(occurredAt ? { occurredAt } : {}),
    fetchedAt: optionalString(draft.fetchedAt) ?? fetchedAt,
    analysis,
    confidence,
    dedupeKey: buildDedupeKey(secid, title, summary, sourceName, sourceUrl)
  };
}

function validateHistory(value: unknown): WatchNewsHistory {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("持仓股消息历史格式错误");
  }
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || !Array.isArray(record.messages)) {
    throw new Error("持仓股消息历史格式错误");
  }
  return {
    version: 1,
    messages: record.messages.map(validateMessage)
  };
}

function validateMessage(value: unknown): WatchNewsMessage {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("持仓股消息记录格式错误");
  }
  const record = value as Record<string, unknown>;
  return {
    id: nonEmpty(record.id, "消息 id"),
    secid: nonEmpty(record.secid, "股票 secid"),
    stockName: nonEmpty(record.stockName, "股票名称"),
    title: nonEmpty(record.title, "消息标题"),
    summary: nonEmpty(record.summary, "消息摘要"),
    sourceName: nonEmpty(record.sourceName, "消息来源"),
    ...(optionalString(record.sourceUrl) ? { sourceUrl: optionalString(record.sourceUrl) } : {}),
    ...(optionalString(record.occurredAt) ? { occurredAt: optionalString(record.occurredAt) } : {}),
    fetchedAt: nonEmpty(record.fetchedAt, "获取时间"),
    analysis: nonEmpty(record.analysis, "分析意见"),
    confidence: normalizeConfidence(record.confidence),
    dedupeKey: nonEmpty(record.dedupeKey, "去重 key"),
    ...(optionalString(record.readAt) ? { readAt: optionalString(record.readAt) } : {})
  };
}

function buildDedupeKey(
  secid: string,
  title: string,
  summary: string,
  sourceName: string,
  sourceUrl: string | undefined
): string {
  const core = sourceUrl || `${sourceName}|${title}|${summary.slice(0, 80)}`;
  return `${secid}|${normalizeText(core)}`;
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeConfidence(value: unknown): WatchNewsConfidence {
  return value === "high" || value === "medium" || value === "low" ? value : "medium";
}

function nonEmpty(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name}不能为空`);
  }
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
