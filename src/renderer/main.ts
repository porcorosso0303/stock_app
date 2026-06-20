import "./styles.css";
import { elements } from "./app/dom";
import {
  createShellController,
  type FeatureName
} from "./app/shell-controller";
import { createResearchController } from "./features/research/research-controller";
import { createWatchController } from "./features/watch/watch-controller";
import type { WatchMarketProviderId } from "../shared/types";
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
  watchController.hydrate(state.watchTree);
  researchController.initialize(state, await api.getResearchSpec());
  api.onResearchEvent(researchController.handleProgress);
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

function resolveWatchMarketProviderId(value: unknown): WatchMarketProviderId {
  return value === "mock-cache" ? "mock-cache" : "east-money";
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
