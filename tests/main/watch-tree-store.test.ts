import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WatchTreeStore } from "../../src/main/watch-tree-store";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true
  })));
});

describe("WatchTreeStore", () => {
  it("returns an empty config and persists a validated tree", async () => {
    const directory = await mkdtemp(join(tmpdir(), "watch-tree-store-"));
    directories.push(directory);
    const path = join(directory, "watch-tree.json");
    const store = new WatchTreeStore(path);
    const config = {
      root: { id: "root", type: "category" as const, name: "科技股", children: [] }
    };

    await expect(store.get()).resolves.toEqual({});
    await expect(store.set(config)).resolves.toEqual(config);
    await expect(new WatchTreeStore(path).get()).resolves.toEqual(config);
  });
});
