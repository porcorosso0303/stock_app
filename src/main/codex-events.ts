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
    return lines.flatMap((line) => line ? [parseLine(line)] : []);
  }

  flush(): CodexDisplayEvent[] {
    if (!this.buffered) {
      return [];
    }
    const line = this.buffered;
    this.buffered = "";
    return [parseLine(line)];
  }
}

function parseLine(raw: string): CodexDisplayEvent {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return {
      raw,
      text: extractReadableText(parsed) ?? JSON.stringify(parsed),
      level: inferLevel(parsed)
    };
  } catch {
    return {
      raw,
      text: `无法解析 Codex JSONL 输出：${raw}`,
      level: "warning"
    };
  }
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
  if (!value || typeof value !== "object") {
    return "info";
  }
  const type = String((value as Record<string, unknown>).type ?? "").toLowerCase();
  return type.includes("error") || type.includes("failed") ? "error" : "info";
}
