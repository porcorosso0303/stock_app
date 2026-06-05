export interface IpcMainLike {
  handle(
    channel: string,
    handler: (event: unknown, value?: unknown) => unknown
  ): void;
}

export function requireObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("IPC 参数必须是对象");
  }
  return value as Record<string, unknown>;
}

export function requireString(value: unknown, name: string): string {
  if (typeof value !== "string") {
    throw new Error(`IPC 参数 ${name} 必须是字符串`);
  }
  return value;
}

export function requireStringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`IPC 参数 ${name} 必须是字符串数组`);
  }
  return value;
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
