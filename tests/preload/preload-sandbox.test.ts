import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("sandboxed preload", () => {
  it("does not import runtime values from local modules", async () => {
    const source = await readFile("src/preload/index.ts", "utf8");

    expect(source).not.toMatch(/import\s+\{[^}]*\bIPC\b[^}]*\}\s+from\s+["']\.\.\/shared\/ipc["']/);
    expect(source).toContain("satisfies typeof import(\"../shared/ipc\").IPC");
    expect(source).toContain("getModelProviderSettings");
    expect(source).toContain("setModelProviderSettings");
    expect(source).toContain("onOpenModelProviderSettings");
  });
});
