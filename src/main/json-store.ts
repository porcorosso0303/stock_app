import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export class JsonStore<T> {
  constructor(
    private readonly path: string,
    private readonly createDefault: () => T
  ) {}

  async read(): Promise<T> {
    try {
      const content = await readFile(this.path, "utf8");
      return JSON.parse(content) as T;
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return this.createDefault();
      }
      if (error instanceof SyntaxError) {
        throw new Error(`无法解析 JSON 文件：${this.path}`, { cause: error });
      }
      throw error;
    }
  }

  async write(value: T): Promise<void> {
    const parentDirectory = dirname(this.path);
    await mkdir(parentDirectory, { recursive: true });
    const temporaryPath = `${this.path}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temporaryPath, this.path);
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
