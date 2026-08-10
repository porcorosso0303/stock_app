import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  it("returns a canonical empty workspace and persists a canonical forest", async () => {
    const directory = await mkdtemp(join(tmpdir(), "watch-tree-store-"));
    directories.push(directory);
    const path = join(directory, "watch-tree.json");
    const store = new WatchTreeStore(path);
    const config = {
      activeWorkspaceId: "default",
      workspaces: [{
        id: "default",
        name: "默认",
        roots: [
          { id: "root-a", type: "category" as const, name: "科技股", children: [] },
          { id: "root-b", type: "category" as const, name: "消费股", children: [] }
        ],
        rootPositions: {
          "root-a": { x: 24, y: 24 },
          "root-b": { x: 520, y: 180 }
        }
      }]
    };

    await expect(store.get()).resolves.toEqual({
      activeWorkspaceId: "default",
      workspaces: [{ id: "default", name: "默认", roots: [], rootPositions: {} }]
    });
    await expect(store.set(config)).resolves.toEqual(config);
    await expect(new WatchTreeStore(path).get()).resolves.toEqual(config);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(config);
  });

  it("migrates a legacy single root while loading and writes only the canonical format", async () => {
    const directory = await mkdtemp(join(tmpdir(), "watch-tree-store-"));
    directories.push(directory);
    const path = join(directory, "watch-tree.json");
    await writeFile(path, JSON.stringify({
      root: { id: "root", type: "category", name: "科技股", children: [] }
    }), "utf8");
    const store = new WatchTreeStore(path);

    const migrated = await store.get();
    expect(migrated).toEqual({
      activeWorkspaceId: "default",
      workspaces: [{
        id: "default",
        name: "默认",
        roots: [{ id: "root", type: "category", name: "科技股", children: [] }],
        rootPositions: { root: { x: 24, y: 24 } }
      }]
    });

    await store.set(migrated);
    expect(JSON.parse(await readFile(path, "utf8"))).not.toHaveProperty("root");
  });
});
