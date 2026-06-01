import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { ResearchSpecStore } from "../../src/main/research-spec-store";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true
  })));
});

async function createHarness() {
  const directory = await mkdtemp(join(tmpdir(), "stock-tool-spec-"));
  directories.push(directory);
  const defaultSpecPath = join(directory, "default.md");
  const userSpecPath = join(directory, "user", "stock_research_spec.md");
  await writeFile(defaultSpecPath, "default spec", "utf8");
  return {
    store: new ResearchSpecStore(userSpecPath, defaultSpecPath),
    userSpecPath
  };
}

describe("ResearchSpecStore", () => {
  it("initializes the user spec from the embedded default", async () => {
    const { store, userSpecPath } = await createHarness();

    await expect(store.get()).resolves.toBe("default spec");
    await expect(readFile(userSpecPath, "utf8")).resolves.toBe("default spec");
  });

  it("persists user edits", async () => {
    const { store } = await createHarness();

    await store.set("custom spec");

    await expect(store.get()).resolves.toBe("custom spec");
  });

  it("rejects an empty user spec", async () => {
    const { store } = await createHarness();

    await expect(store.set("  ")).rejects.toThrow("不能为空");
  });

  it("restores the embedded default without changing it", async () => {
    const { store, userSpecPath } = await createHarness();
    await store.set("custom spec");

    await expect(store.reset()).resolves.toBe("default spec");

    await expect(store.get()).resolves.toBe("default spec");
    await expect(readFile(userSpecPath, "utf8")).resolves.toBe("default spec");
    await expect(store.getDefault()).resolves.toBe("default spec");
  });
});
