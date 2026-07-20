import { describe, expect, it, vi } from "vitest";
import {
  ModelProviderManager,
  type ModelProviderBundleFactory,
  type ModelProviderContext
} from "../../src/main/model-provider-manager";

function bundle(id: "codex-cli" | "deepseek"): ModelProviderBundleFactory {
  return {
    id,
    createResearchProvider: vi.fn((context: ModelProviderContext) => ({
      id,
      label: `${id}:${context.settings.deepSeekModel}`,
      detect: async () => ({ available: true }),
      run: async () => ({ status: "cancelled" as const }),
      cancel: () => undefined
    })),
    createWatchNewsProvider: vi.fn(() => ({ analyze: async () => [] }))
  };
}

describe("ModelProviderManager", () => {
  it("constructs Codex providers without requiring API secrets", async () => {
    const codex = bundle("codex-cli");
    const getSecrets = vi.fn().mockResolvedValue({});
    const manager = new ModelProviderManager({
      configStore: {
        getModelProviderSettings: async () => ({
          providerId: "codex-cli",
          deepSeekBaseUrl: "https://api.deepseek.com",
          deepSeekModel: "deepseek-v4-pro"
        })
      },
      secretsStore: { getSecrets },
      bundles: [codex]
    });

    await expect(manager.resolveResearchProvider()).resolves.toMatchObject({ id: "codex-cli" });
    expect(getSecrets).not.toHaveBeenCalled();
  });

  it("requires both DeepSeek and Tavily API keys", async () => {
    const manager = new ModelProviderManager({
      configStore: {
        getModelProviderSettings: async () => ({
          providerId: "deepseek",
          deepSeekBaseUrl: "https://api.deepseek.com",
          deepSeekModel: "deepseek-v4-pro"
        })
      },
      secretsStore: { getSecrets: async () => ({ deepSeekApiKey: "model-key" }) },
      bundles: [bundle("deepseek")]
    });

    await expect(manager.resolveWatchNewsProvider()).rejects.toThrow("Tavily API Key");
  });

  it("takes a fresh immutable configuration snapshot for each resolved task", async () => {
    const deepseek = bundle("deepseek");
    let model = "deepseek-v4-pro";
    const manager = new ModelProviderManager({
      configStore: {
        getModelProviderSettings: async () => ({
          providerId: "deepseek",
          deepSeekBaseUrl: "https://api.deepseek.com",
          deepSeekModel: model
        })
      },
      secretsStore: {
        getSecrets: async () => ({ deepSeekApiKey: "model-key", tavilyApiKey: "search-key" })
      },
      bundles: [deepseek]
    });

    const first = await manager.resolveResearchProvider();
    model = "deepseek-v4-flash";
    const second = await manager.resolveResearchProvider();

    expect(first.label).toContain("deepseek-v4-pro");
    expect(second.label).toContain("deepseek-v4-flash");
    const factory = vi.mocked(deepseek.createResearchProvider);
    expect(factory.mock.calls[0][0]).not.toBe(factory.mock.calls[1][0]);
    expect(Object.isFrozen(factory.mock.calls[0][0].settings)).toBe(true);
  });
});
