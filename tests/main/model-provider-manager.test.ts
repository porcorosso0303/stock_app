import { describe, expect, it, vi } from "vitest";
import {
  ModelProviderManager,
  type ModelProviderBundleFactory,
  type ModelProviderContext
} from "../../src/main/model-provider-manager";
import type { DeepSeekReasoningEffort } from "../../src/shared/types";

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
          deepSeekModel: "deepseek-v4-pro",
          deepSeekReasoningEffort: "high"
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
          deepSeekModel: "deepseek-v4-pro",
          deepSeekReasoningEffort: "high"
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
    let reasoningEffort: DeepSeekReasoningEffort = "high";
    const manager = new ModelProviderManager({
      configStore: {
        getModelProviderSettings: async () => ({
          providerId: "deepseek",
          deepSeekBaseUrl: "https://api.deepseek.com",
          deepSeekModel: model,
          deepSeekReasoningEffort: reasoningEffort
        })
      },
      secretsStore: {
        getSecrets: async () => ({ deepSeekApiKey: "model-key", tavilyApiKey: "search-key" })
      },
      bundles: [deepseek]
    });

    const first = await manager.resolveResearchProvider();
    model = "deepseek-v4-flash";
    reasoningEffort = "max";
    await manager.resolveWatchNewsProvider();

    expect(first.label).toContain("deepseek-v4-pro");
    const researchContext = vi.mocked(deepseek.createResearchProvider).mock.calls[0][0];
    const watchNewsContext = vi.mocked(deepseek.createWatchNewsProvider).mock.calls[0][0];
    expect(researchContext.settings).toMatchObject({
      deepSeekModel: "deepseek-v4-pro",
      deepSeekReasoningEffort: "high"
    });
    expect(watchNewsContext.settings).toMatchObject({
      deepSeekModel: "deepseek-v4-flash",
      deepSeekReasoningEffort: "max"
    });
    expect(researchContext).not.toBe(watchNewsContext);
    expect(Object.isFrozen(researchContext.settings)).toBe(true);
    expect(Object.isFrozen(watchNewsContext.settings)).toBe(true);
  });
});
