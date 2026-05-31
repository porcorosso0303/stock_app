import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { ConfigStore } from "../../src/main/config-store";

const directories: string[] = [];

async function createTempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "stock-tool-config-"));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true
  })));
});

describe("ConfigStore", () => {
  it("returns an empty config when the file does not exist", async () => {
    const directory = await createTempDirectory();
    const store = new ConfigStore(join(directory, "config.json"));

    await expect(store.get()).resolves.toEqual({});
  });

  it("persists the report directory", async () => {
    const directory = await createTempDirectory();
    const path = join(directory, "config.json");

    await new ConfigStore(path).setReportDirectory("C:\\reports");

    await expect(new ConfigStore(path).get()).resolves.toEqual({
      reportDirectory: "C:\\reports"
    });
  });

  it("reports a damaged JSON file with its path", async () => {
    const directory = await createTempDirectory();
    const path = join(directory, "config.json");
    await writeFile(path, "{broken", "utf8");

    await expect(new ConfigStore(path).get()).rejects.toThrow(path);
  });
});
