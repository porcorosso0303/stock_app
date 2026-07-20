import "./styles.css";
import { elements } from "./app/dom";
import {
  createShellController,
  type FeatureName
} from "./app/shell-controller";
import { createResearchController } from "./features/research/research-controller";
import { createWatchController } from "./features/watch/watch-controller";
import type {
  CodexEnvironmentStatus,
  ModelProviderId,
  ModelProviderSettingsView,
  WatchMarketProviderId
} from "../shared/types";
import { initializationErrorMessage } from "./view-model";

const api = window.stockResearch;
let activeFeature: FeatureName = "research";

const watchController = createWatchController({
  api,
  elements,
  isActive: () => activeFeature === "watch"
});

const shellController = createShellController({
  elements,
  onFeatureChanged: (feature) => {
    activeFeature = feature;
  },
  onActivateWatch: async () => {
    await watchController.activate();
  },
  onDeactivateWatch: () => watchController.deactivate()
});

const researchController = createResearchController({
  api,
  elements,
  selectTab: shellController.selectTab
});

void initialize().catch((error: unknown) => {
  const message = initializationErrorMessage(error);
  elements.codexStatus.textContent = message;
  elements.taskStatus.textContent = message;
});

async function initialize(): Promise<void> {
  watchController.bindEvents();
  shellController.bindEvents();
  researchController.bindEvents();

  const state = await api.getBootstrap();
  bindMarketProviderSettings(resolveWatchMarketProviderId(state.config.watchMarketProviderId));
  bindWatchNewsSettings(state.config.watchNewsIntervalHours ?? 3);
  bindModelProviderSettings(state.codex);
  watchController.hydrate(state.watchTree);
  researchController.initialize(state, await api.getResearchSpec());
  api.onResearchEvent(researchController.handleProgress);
  api.onWatchNewsUpdated(() => {
    if (activeFeature === "watch") {
      void watchController.refreshNewsState();
    }
  });
}

function bindModelProviderSettings(initialCodexStatus: CodexEnvironmentStatus): void {
  let current: ModelProviderSettingsView | undefined;
  let codexStatus = initialCodexStatus;
  let clearDeepSeekApiKey = false;
  let clearTavilyApiKey = false;
  renderCodexStatus();

  api.onOpenModelProviderSettings(() => {
    elements.modelProviderStatus.textContent = "正在读取设置...";
    elements.modelProviderDialog.showModal();
    void loadSettings();
  });
  elements.modelProviderSelect.addEventListener("change", renderProviderSection);
  elements.cancelModelProvider.addEventListener("click", () => elements.modelProviderDialog.close());
  elements.clearDeepSeekApiKey.addEventListener("click", () => {
    clearDeepSeekApiKey = true;
    elements.deepSeekApiKey.value = "";
    renderSecretStatus();
  });
  elements.clearTavilyApiKey.addEventListener("click", () => {
    clearTavilyApiKey = true;
    elements.tavilyApiKey.value = "";
    renderSecretStatus();
  });
  elements.redetectModelCodex.addEventListener("click", () => {
    elements.codexModelStatus.textContent = "正在检测...";
    void api.redetectCodex().then((status) => {
      codexStatus = status;
      renderCodexStatus();
    }).catch((error) => {
      elements.codexModelStatus.textContent = getErrorMessage(error);
    });
  });
  elements.modelProviderForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void saveSettings();
  });

  async function loadSettings(): Promise<void> {
    try {
      current = await api.getModelProviderSettings();
      clearDeepSeekApiKey = false;
      clearTavilyApiKey = false;
      elements.modelProviderSelect.value = current.providerId;
      elements.deepSeekBaseUrl.value = current.deepSeekBaseUrl;
      elements.deepSeekModel.value = current.deepSeekModel;
      elements.deepSeekApiKey.value = "";
      elements.tavilyApiKey.value = "";
      elements.modelProviderStatus.textContent = "";
      renderProviderSection();
      renderSecretStatus();
    } catch (error) {
      elements.modelProviderStatus.textContent = getErrorMessage(error);
    }
  }

  async function saveSettings(): Promise<void> {
    if (!current) return;
    const providerId = readModelProviderId(elements.modelProviderSelect.value);
    const hasDeepSeekApiKey = Boolean(elements.deepSeekApiKey.value.trim())
      || (current.hasDeepSeekApiKey && !clearDeepSeekApiKey);
    const hasTavilyApiKey = Boolean(elements.tavilyApiKey.value.trim())
      || (current.hasTavilyApiKey && !clearTavilyApiKey);
    if (providerId === "deepseek" && (!hasDeepSeekApiKey || !hasTavilyApiKey)) {
      elements.modelProviderStatus.textContent = "DeepSeek 模式需要同时配置 DeepSeek 和 Tavily API Key";
      return;
    }
    elements.modelProviderStatus.textContent = "正在保存...";
    try {
      current = await api.setModelProviderSettings({
        providerId,
        deepSeekBaseUrl: elements.deepSeekBaseUrl.value,
        deepSeekModel: elements.deepSeekModel.value,
        deepSeekApiKey: elements.deepSeekApiKey.value.trim() || undefined,
        tavilyApiKey: elements.tavilyApiKey.value.trim() || undefined,
        clearDeepSeekApiKey,
        clearTavilyApiKey
      });
      elements.modelProviderDialog.close();
    } catch (error) {
      elements.modelProviderStatus.textContent = getErrorMessage(error);
    }
  }

  function renderProviderSection(): void {
    const isDeepSeek = elements.modelProviderSelect.value === "deepseek";
    elements.codexModelSettings.hidden = isDeepSeek;
    elements.deepSeekModelSettings.hidden = !isDeepSeek;
  }

  function renderSecretStatus(): void {
    elements.deepSeekApiKeyStatus.textContent = clearDeepSeekApiKey
      ? "保存后清除"
      : current?.hasDeepSeekApiKey ? "已配置" : "未配置";
    elements.tavilyApiKeyStatus.textContent = clearTavilyApiKey
      ? "保存后清除"
      : current?.hasTavilyApiKey ? "已配置" : "未配置";
  }

  function renderCodexStatus(): void {
    elements.codexModelStatus.textContent = codexStatus.available
      ? codexStatus.loggedIn === false ? "Codex CLI 未登录" : `Codex CLI 可用${codexStatus.version ? `：${codexStatus.version}` : ""}`
      : codexStatus.message ?? "Codex CLI 不可用";
  }
}

function readModelProviderId(value: string): ModelProviderId {
  return value === "deepseek" ? "deepseek" : "codex-cli";
}

function bindMarketProviderSettings(initialProviderId: WatchMarketProviderId): void {
  let currentProviderId = initialProviderId;
  elements.marketProviderSelect.value = currentProviderId;
  api.onOpenWatchMarketProviderSettings(() => {
    elements.marketProviderSelect.value = currentProviderId;
    elements.marketProviderStatus.textContent = "";
    elements.marketProviderDialog.showModal();
  });
  elements.cancelMarketProvider.addEventListener("click", () => {
    elements.marketProviderDialog.close();
  });
  elements.marketProviderForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void saveMarketProvider();
  });

  async function saveMarketProvider(): Promise<void> {
    const providerId = resolveWatchMarketProviderId(elements.marketProviderSelect.value);
    elements.marketProviderStatus.textContent = "正在保存...";
    try {
      const config = await api.setWatchMarketProvider(providerId);
      currentProviderId = resolveWatchMarketProviderId(config.watchMarketProviderId);
      elements.marketProviderSelect.value = currentProviderId;
      elements.marketProviderStatus.textContent = "";
      elements.marketProviderDialog.close();
    } catch (error) {
      elements.marketProviderStatus.textContent = getErrorMessage(error);
    }
  }
}

function bindWatchNewsSettings(initialIntervalHours: number): void {
  let currentIntervalHours = normalizeWatchNewsIntervalHours(initialIntervalHours);
  elements.watchNewsIntervalHours.value = String(currentIntervalHours);
  api.onOpenWatchNewsSettings(() => {
    elements.watchNewsIntervalHours.value = String(currentIntervalHours);
    elements.watchNewsSettingsStatus.textContent = "";
    elements.watchNewsSettingsDialog.showModal();
  });
  elements.cancelWatchNewsSettings.addEventListener("click", () => {
    elements.watchNewsSettingsDialog.close();
  });
  elements.watchNewsSettingsForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void saveWatchNewsSettings();
  });

  async function saveWatchNewsSettings(): Promise<void> {
    const intervalHours = normalizeWatchNewsIntervalHours(Number(elements.watchNewsIntervalHours.value));
    elements.watchNewsSettingsStatus.textContent = "正在保存...";
    try {
      const config = await api.setWatchNewsSettings({ intervalHours });
      currentIntervalHours = normalizeWatchNewsIntervalHours(config.watchNewsIntervalHours ?? intervalHours);
      elements.watchNewsIntervalHours.value = String(currentIntervalHours);
      elements.watchNewsSettingsStatus.textContent = "";
      elements.watchNewsSettingsDialog.close();
    } catch (error) {
      elements.watchNewsSettingsStatus.textContent = getErrorMessage(error);
    }
  }
}

function resolveWatchMarketProviderId(value: unknown): WatchMarketProviderId {
  return value === "mock-cache" ? "mock-cache" : "east-money";
}

function normalizeWatchNewsIntervalHours(value: unknown): number {
  const interval = Number(value);
  if (!Number.isFinite(interval) || interval <= 0) {
    return 3;
  }
  return Math.min(168, Math.max(0.1, interval));
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
