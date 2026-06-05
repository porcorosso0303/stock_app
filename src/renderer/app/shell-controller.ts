import type { RendererElements } from "./dom";

export type FeatureName = "research" | "watch";
export type TabName = "report" | "output" | "spec";

export interface ShellController {
  bindEvents(): void;
  activateFeature(feature: FeatureName): Promise<void>;
  getActiveFeature(): FeatureName;
  selectTab(name: TabName): void;
}

interface ShellControllerOptions {
  elements: RendererElements;
  onFeatureChanged?: (feature: FeatureName) => void;
  onActivateWatch: () => Promise<void>;
  onDeactivateWatch: () => void;
}

export function createShellController(options: ShellControllerOptions): ShellController {
  let activeFeature: FeatureName = "research";

  async function activateFeature(feature: FeatureName): Promise<void> {
    activeFeature = feature;
    options.onFeatureChanged?.(feature);
    options.elements.researchSidebarContent.hidden = feature !== "research";
    options.elements.researchWorkspace.hidden = feature !== "research";
    options.elements.watchWorkspace.hidden = feature !== "watch";
    document.querySelectorAll<HTMLButtonElement>(".feature-button").forEach((button) => {
      button.classList.toggle("active", button.dataset.feature === feature);
    });
    if (feature === "watch") {
      await options.onActivateWatch();
    } else {
      options.onDeactivateWatch();
    }
  }

  function selectTab(name: TabName): void {
    options.elements.reportPanel.hidden = name !== "report";
    options.elements.outputPanel.hidden = name !== "output";
    options.elements.specPanel.hidden = name !== "spec";
    document.querySelectorAll<HTMLButtonElement>(".tab").forEach((tab) => {
      tab.classList.toggle("active", tab.dataset.tab === name);
    });
  }

  return {
    bindEvents: () => {
      document.querySelectorAll<HTMLButtonElement>(".feature-button").forEach((button) => {
        button.addEventListener("click", () => {
          void activateFeature(button.dataset.feature === "watch" ? "watch" : "research");
        });
      });
      document.querySelectorAll<HTMLButtonElement>(".tab").forEach((tab) => {
        tab.addEventListener("click", () => {
          const name = tab.dataset.tab;
          selectTab(name === "output" || name === "spec" ? name : "report");
        });
      });
    },
    activateFeature,
    getActiveFeature: () => activeFeature,
    selectTab
  };
}
