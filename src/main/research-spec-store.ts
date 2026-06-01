import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export class ResearchSpecStore {
  constructor(
    private readonly path: string,
    private readonly defaultSpecPath: string
  ) {}

  async get(): Promise<string> {
    try {
      return await readFile(this.path, "utf8");
    } catch (error) {
      if (!isNodeError(error) || error.code !== "ENOENT") {
        throw error;
      }
    }

    const defaultSpec = await this.getDefault();
    await this.set(defaultSpec);
    return defaultSpec;
  }

  getDefault(): Promise<string> {
    return readFile(this.defaultSpecPath, "utf8");
  }

  async reset(): Promise<string> {
    const defaultSpec = await this.getDefault();
    await this.set(defaultSpec);
    return defaultSpec;
  }

  async set(spec: string): Promise<void> {
    if (!spec.trim()) {
      throw new Error("调研规范不能为空");
    }
    const parentDirectory = dirname(this.path);
    await mkdir(parentDirectory, { recursive: true });
    const temporaryPath = `${this.path}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, spec, "utf8");
    await rename(temporaryPath, this.path);
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
