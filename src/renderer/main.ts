import "./styles.css";
import { elements } from "./app/dom";
import {
  createShellController,
  type FeatureName
} from "./app/shell-controller";
import { createResearchController } from "./features/research/research-controller";
import { createWatchController } from "./features/watch/watch-controller";
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
  watchController.hydrate(state.watchTree);
  researchController.initialize(state, await api.getResearchSpec());
  api.onResearchEvent(researchController.handleProgress);
}
