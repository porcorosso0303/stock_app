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

  it("preserves provider selection fields for future module configuration", async () => {
    const directory = await createTempDirectory();
    const path = join(directory, "config.json");
    await writeFile(path, JSON.stringify({
      watchMarketProviderId: "east-money",
      researchProviderId: "codex-cli"
    }), "utf8");

    const updated = await new ConfigStore(path).setReportDirectory("C:\\reports");

    expect(updated).toEqual({
      reportDirectory: "C:\\reports",
      watchMarketProviderId: "east-money",
      researchProviderId: "codex-cli"
    });
    await expect(new ConfigStore(path).get()).resolves.toEqual(updated);
  });

  it("persists the selected watch market provider", async () => {
    const directory = await createTempDirectory();
    const path = join(directory, "config.json");

    const updated = await new ConfigStore(path).setWatchMarketProviderId("mock-cache");

    expect(updated).toEqual({
      watchMarketProviderId: "mock-cache"
    });
    await expect(new ConfigStore(path).get()).resolves.toEqual(updated);
  });

  it("persists the watch news interval", async () => {
    const directory = await createTempDirectory();
    const path = join(directory, "config.json");

    const updated = await new ConfigStore(path).setWatchNewsIntervalHours(2.5);

    expect(updated).toEqual({
      watchNewsIntervalHours: 2.5
    });
    await expect(new ConfigStore(path).get()).resolves.toEqual(updated);
  });

  it("reports a damaged JSON file with its path", async () => {
    const directory = await createTempDirectory();
    const path = join(directory, "config.json");
    await writeFile(path, "{broken", "utf8");

    await expect(new ConfigStore(path).get()).rejects.toThrow(path);
  });

  it("normalizes missing model provider settings to Codex defaults", async () => {
    const directory = await createTempDirectory();
    const store = new ConfigStore(join(directory, "config.json"));

    await expect(store.getModelProviderSettings()).resolves.toEqual({
      providerId: "codex-cli",
      deepSeekBaseUrl: "https://api.deepseek.com",
      deepSeekModel: "deepseek-v4-pro"
    });
  });

  it("maps the legacy research provider setting", async () => {
    const directory = await createTempDirectory();
    const path = join(directory, "config.json");
    await writeFile(path, JSON.stringify({ researchProviderId: "deepseek" }), "utf8");

    await expect(new ConfigStore(path).getModelProviderSettings()).resolves.toMatchObject({
      providerId: "deepseek"
    });
  });

  it("persists non-secret DeepSeek settings", async () => {
    const directory = await createTempDirectory();
    const path = join(directory, "config.json");
    const store = new ConfigStore(path);

    await store.setModelProviderSettings({
      providerId: "deepseek",
      deepSeekBaseUrl: "https://gateway.example.com/v1",
      deepSeekModel: "custom-model"
    });

    await expect(new ConfigStore(path).getModelProviderSettings()).resolves.toEqual({
      providerId: "deepseek",
      deepSeekBaseUrl: "https://gateway.example.com/v1",
      deepSeekModel: "custom-model"
    });
    expect(await new ConfigStore(path).get()).not.toHaveProperty("deepSeekApiKey");
    expect(await new ConfigStore(path).get()).not.toHaveProperty("tavilyApiKey");
  });

  it.each([
    [{ providerId: "unknown", deepSeekBaseUrl: "https://api.deepseek.com", deepSeekModel: "deepseek-v4-pro" }, "模型服务"],
    [{ providerId: "deepseek", deepSeekBaseUrl: "http://api.deepseek.com", deepSeekModel: "deepseek-v4-pro" }, "HTTPS"],
    [{ providerId: "deepseek", deepSeekBaseUrl: "not a url", deepSeekModel: "deepseek-v4-pro" }, "URL"],
    [{ providerId: "deepseek", deepSeekBaseUrl: "https://api.deepseek.com", deepSeekModel: "  " }, "模型名称"]
  ])("rejects invalid model settings %#", async (settings, message) => {
    const directory = await createTempDirectory();
    const store = new ConfigStore(join(directory, "config.json"));

    await expect(store.setModelProviderSettings(settings as never)).rejects.toThrow(message);
  });

  it.each([
    "http://localhost:8000/v1",
    "http://127.0.0.1:8000"
  ])("allows a local HTTP DeepSeek-compatible endpoint: %s", async (deepSeekBaseUrl) => {
    const directory = await createTempDirectory();
    const store = new ConfigStore(join(directory, "config.json"));

    await expect(store.setModelProviderSettings({
      providerId: "deepseek",
      deepSeekBaseUrl,
      deepSeekModel: "local-model"
    })).resolves.toMatchObject({ deepSeekBaseUrl });
  });
});
