import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigStore } from "../../src/main/config-store";
import { HistoryStore } from "../../src/main/history-store";
import { ModelProviderManager, type ModelProviderBundleFactory } from "../../src/main/model-provider-manager";
import { ModelSecretsStore } from "../../src/main/model-secrets-store";
import { ResearchService } from "../../src/main/research-service";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true
  })));
});

describe("model provider selection integration", () => {
  it("uses Codex by default and DeepSeek for subsequent tasks after settings change", async () => {
    const directory = await mkdtemp(join(tmpdir(), "model-provider-integration-"));
    directories.push(directory);
    const configStore = new ConfigStore(join(directory, "config.json"));
    await configStore.setReportDirectory(join(directory, "reports"));
    const secretsStore = new ModelSecretsStore(join(directory, "model-secrets.json"), {
      isEncryptionAvailable: () => true,
      encryptString: (value) => Buffer.from(`encrypted:${value}`),
      decryptString: (value) => value.toString().replace(/^encrypted:/, "")
    });
    const codex = createBundle("codex-cli");
    const deepseek = createBundle("deepseek");
    const manager = new ModelProviderManager({
      configStore,
      secretsStore,
      bundles: [codex.bundle, deepseek.bundle]
    });
    let id = 0;
    const service = new ResearchService({
      userDataDirectory: directory,
      configStore,
      historyStore: new HistoryStore(join(directory, "history.json")),
      resolveResearchProvider: async () => await manager.resolveResearchProvider(),
      pdfExporter: { export: async () => undefined },
      createId: () => `run-${++id}`
    });

    await service.start("贵州茅台");
    await secretsStore.update({ deepSeekApiKey: "model-key", tavilyApiKey: "search-key" });
    await configStore.setModelProviderSettings({
      providerId: "deepseek",
      deepSeekBaseUrl: "https://api.deepseek.com",
      deepSeekModel: "deepseek-v4-pro"
    });
    await service.start("中控技术");

    expect(codex.run).toHaveBeenCalledOnce();
    expect(deepseek.run).toHaveBeenCalledOnce();
    expect(codex.run).toHaveBeenCalledWith(expect.objectContaining({ stockName: "贵州茅台" }));
    expect(deepseek.run).toHaveBeenCalledWith(expect.objectContaining({ stockName: "中控技术" }));
  });
});

function createBundle(id: "codex-cli" | "deepseek") {
  const run = vi.fn().mockResolvedValue({ status: "success" as const, reportMarkdown: `# ${id}` });
  const bundle: ModelProviderBundleFactory = {
    id,
    createResearchProvider: () => ({
      id,
      label: id,
      detect: async () => ({ available: true, loggedIn: true }),
      run,
      cancel: vi.fn()
    }),
    createWatchNewsProvider: () => ({ analyze: async () => [] })
  };
  return { bundle, run };
}
