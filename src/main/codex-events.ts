export interface CodexDisplayEvent {
  raw: string;
  text: string;
  level: "info" | "warning" | "error";
}

export class CodexJsonlParser {
  private buffered = "";

  push(chunk: string): CodexDisplayEvent[] {
    this.buffered += chunk;
    const lines = this.buffered.split(/\r?\n/);
    this.buffered = lines.pop() ?? "";
    return lines.flatMap((line) => {
      const event = line ? parseLine(line) : undefined;
      return event ? [event] : [];
    });
  }

  flush(): CodexDisplayEvent[] {
    if (!this.buffered) {
      return [];
    }
    const line = this.buffered;
    this.buffered = "";
    const event = parseLine(line);
    return event ? [event] : [];
  }
}

function parseLine(raw: string): CodexDisplayEvent | undefined {
  try {
    const parsed = JSON.parse(raw) as unknown;
    const text = extractUserFacingText(parsed);
    if (!text) {
      return undefined;
    }
    return {
      raw,
      text,
      level: inferLevel(parsed)
    };
  } catch {
    return undefined;
  }
}

function extractUserFacingText(value: unknown): string | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  const type = normalizeType(record.type);
  const item = asRecord(record.item);
  const itemType = normalizeType(item?.type);
  if (isErrorType(type) || isErrorType(itemType)) {
    const detail = extractReadableText(record.error)
      ?? extractReadableText(item)
      ?? extractReadableText(record.message);
    return detail ? `调研过程中出现错误：${detail}` : "调研过程中出现错误";
  }
  if (isWebSearchType(type) || isWebSearchType(itemType)) {
    const query = extractReadableText(item?.query) ?? extractReadableText(record.query);
    return query ? `正在搜索：${query}` : "正在搜索公开资料";
  }

  const text = extractTopLevelText(record)
    ?? (isReadableItemType(itemType) ? extractReadableText(item) : undefined);
  return text && containsChinese(text) ? text : undefined;
}

function extractTopLevelText(record: Record<string, unknown>): string | undefined {
  for (const key of ["text", "message", "delta", "output_text"]) {
    const text = extractReadableText(record[key]);
    if (text) {
      return text;
    }
  }
  return undefined;
}

function extractReadableText(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  for (const key of ["text", "message", "delta", "output_text"]) {
    const text = extractReadableText(record[key]);
    if (text) {
      return text;
    }
  }
  for (const key of ["item", "error", "content"]) {
    const text = extractReadableText(record[key]);
    if (text) {
      return text;
    }
  }
  return undefined;
}

function inferLevel(value: unknown): CodexDisplayEvent["level"] {
  const record = asRecord(value);
  if (!record) {
    return "info";
  }
  const type = normalizeType(record.type);
  const itemType = normalizeType(asRecord(record.item)?.type);
  return isErrorType(type) || isErrorType(itemType) ? "error" : "info";
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function normalizeType(value: unknown): string {
  return String(value ?? "").toLowerCase();
}

function isErrorType(type: string): boolean {
  return type.includes("error") || type.includes("failed");
}

function isWebSearchType(type: string): boolean {
  return type.includes("web_search");
}

function isReadableItemType(type: string): boolean {
  return !type || type === "reasoning" || type === "agent_message" || type === "message";
}

function containsChinese(value: string): boolean {
  return /[\u3400-\u9fff]/.test(value);
}
