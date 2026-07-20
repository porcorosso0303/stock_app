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
    expect(html).toContain('<select id="deepseek-model">');
    expect(html).toContain('<option value="deepseek-v4-pro">deepseek-v4-pro</option>');
    expect(html).toContain('<option value="deepseek-v4-flash">deepseek-v4-flash</option>');
    expect(html).toContain('<option value="__custom__">自定义模型...</option>');
    expect(html).toContain('id="deepseek-custom-model-settings"');
    expect(html).toContain('id="deepseek-custom-model"');
    expect(html).toContain('aria-describedby="model-provider-status"');
    expect(html).toContain('id="model-provider-status" class="dialog-error" role="alert" aria-live="polite"');
    expect(html).not.toContain('list="deepseek-model-options"');
    expect(html).not.toContain('id="deepseek-model-options"');
    expect(html).toContain('id="deepseek-reasoning-effort"');
    expect(html).toContain('<option value="high">high</option>');
    expect(html).toContain('<option value="max">max</option>');
    expect(html).toContain('id="deepseek-api-key" type="password"');
    expect(html).toContain('id="tavily-api-key" type="password"');
    expect(html).not.toMatch(/value="[^\"]*(?:sk-|tvly-)/);
    expect(dom).toContain('modelProviderDialog: getElement<HTMLDialogElement>("model-provider-dialog")');
    expect(dom).toContain('deepSeekModel: getElement<HTMLSelectElement>("deepseek-model")');
    expect(dom).toContain('deepSeekCustomModelSettings: getElement<HTMLElement>("deepseek-custom-model-settings")');
    expect(dom).toContain('deepSeekCustomModel: getElement<HTMLInputElement>("deepseek-custom-model")');
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
    expect(main).toContain("resolveDeepSeekModelForm");
    expect(main).toContain("resolveDeepSeekModelValue");
    expect(main).toContain('elements.deepSeekModel.addEventListener("change", renderDeepSeekCustomModel)');
    expect(main).toContain("elements.deepSeekCustomModel.value = modelForm.custom");
    expect(main).toContain("elements.deepSeekCustomModelSettings.hidden");
    expect(main).toContain("elements.deepSeekCustomModel.required = isDeepSeek && isCustom");
    expect(main).toContain('providerId === "deepseek" ? "" : current.deepSeekModel');
    expect(main).toContain("elements.deepSeekReasoningEffort.value = current.deepSeekReasoningEffort");
    expect(main).toContain("deepSeekReasoningEffort: elements.deepSeekReasoningEffort.value");
  });
});
