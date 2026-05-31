import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { HistoryStore } from "../../src/main/history-store";
import type { ResearchRecord } from "../../src/shared/types";

const directories: string[] = [];

async function createStore(): Promise<HistoryStore> {
  const directory = await mkdtemp(join(tmpdir(), "stock-tool-history-"));
  directories.push(directory);
  return new HistoryStore(join(directory, "history.json"));
}

function createRecord(id: string, createdAt: string): ResearchRecord {
  return {
    id,
    stockName: `股票-${id}`,
    createdAt,
    updatedAt: createdAt,
    status: "running",
    reportMarkdownPath: `${id}/report.md`,
    eventsPath: `${id}/events.jsonl`,
    stderrPath: `${id}/stderr.log`
  };
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true
  })));
});

describe("HistoryStore", () => {
  it("lists records by newest creation time first", async () => {
    const store = await createStore();
    await store.create(createRecord("old", "2026-05-30T00:00:00.000Z"));
    await store.create(createRecord("new", "2026-05-31T00:00:00.000Z"));

    await expect(store.list()).resolves.toMatchObject([
      { id: "new" },
      { id: "old" }
    ]);
  });

  it("updates status without discarding existing fields", async () => {
    const store = await createStore();
    await store.create(createRecord("one", "2026-05-31T00:00:00.000Z"));

    const result = await store.update("one", {
      status: "failed",
      errorMessage: "network error"
    });

    expect(result).toMatchObject({
      id: "one",
      stockName: "股票-one",
      status: "failed",
      errorMessage: "network error"
    });
  });

  it("returns undefined for an unknown record", async () => {
    const store = await createStore();
    await expect(store.get("missing")).resolves.toBeUndefined();
  });
});
