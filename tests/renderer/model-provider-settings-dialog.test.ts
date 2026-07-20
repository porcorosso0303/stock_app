import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("model provider settings dialog", () => {
  it("renders an independent model service dialog without populated secret values", async () => {
    const html = await readFile("src/renderer/index.html", "utf8");
    const dom = await readFile("src/renderer/app/dom.ts", "utf8");

    expect(html).toContain('id="model-provider-dialog"');
    expect(html).toContain('id="model-provider-select"');
    expect(html).toContain("OpenAI Codex");
    expect(html).toContain("DeepSeek");
    expect(html).toContain('id="deepseek-base-url"');
    expect(html).toContain('id="deepseek-model"');
    expect(html).toContain("deepseek-v4-pro");
    expect(html).toContain("deepseek-v4-flash");
    expect(html).toContain('id="deepseek-reasoning-effort"');
    expect(html).toContain('<option value="high">high</option>');
    expect(html).toContain('<option value="max">max</option>');
    expect(html).toContain('id="deepseek-api-key" type="password"');
    expect(html).toContain('id="tavily-api-key" type="password"');
    expect(html).not.toMatch(/value="[^\"]*(?:sk-|tvly-)/);
    expect(dom).toContain('modelProviderDialog: getElement<HTMLDialogElement>("model-provider-dialog")');
    expect(dom).toContain('deepSeekReasoningEffort: getElement<HTMLSelectElement>("deepseek-reasoning-effort")');
  });

  it("loads status on open and saves through the model provider API", async () => {
    const ipc = await readFile("src/shared/ipc.ts", "utf8");
    const preload = await readFile("src/preload/index.ts", "utf8");
    const main = await readFile("src/renderer/main.ts", "utf8");

    expect(ipc).toContain('getModelProviderSettings: "model-provider-settings:get"');
    expect(ipc).toContain('setModelProviderSettings: "model-provider-settings:set"');
    expect(ipc).toContain('openModelProviderSettings: "model-provider-settings:open"');
    expect(preload).toContain("getModelProviderSettings");
    expect(preload).toContain("setModelProviderSettings");
    expect(preload).toContain("onOpenModelProviderSettings");
    expect(main).toContain("bindModelProviderSettings");
    expect(main).toContain("api.getModelProviderSettings");
    expect(main).toContain("api.setModelProviderSettings");
    expect(main).toContain("hasDeepSeekApiKey");
    expect(main).toContain("hasTavilyApiKey");
    expect(main).toContain("elements.deepSeekReasoningEffort.value = current.deepSeekReasoningEffort");
    expect(main).toContain("deepSeekReasoningEffort: elements.deepSeekReasoningEffort.value");
  });
});
