import type { ModelProviderId, ModelProviderSettings } from "../shared/types";
import type { ResearchProvider } from "./modules/research/providers/research-provider";
import type { ModelSecrets } from "./model-secrets-store";
import type { WatchNewsAnalysisProvider } from "./watch-news-analysis-provider";

interface ModelConfigStoreLike {
  getModelProviderSettings(): Promise<ModelProviderSettings>;
}

interface ModelSecretsStoreLike {
  getSecrets(): Promise<ModelSecrets>;
}

export interface ModelProviderContext {
  readonly settings: Readonly<ModelProviderSettings>;
  readonly secrets: Readonly<ModelSecrets>;
}

export interface ModelProviderBundleFactory {
  readonly id: ModelProviderId;
  createResearchProvider(context: ModelProviderContext): ResearchProvider;
  createWatchNewsProvider(context: ModelProviderContext): WatchNewsAnalysisProvider;
}

export interface ModelProviderManagerDependencies {
  configStore: ModelConfigStoreLike;
  secretsStore: ModelSecretsStoreLike;
  bundles: ModelProviderBundleFactory[];
}

export class ModelProviderManager {
  private readonly bundles: Map<ModelProviderId, ModelProviderBundleFactory>;

  constructor(private readonly dependencies: ModelProviderManagerDependencies) {
    this.bundles = new Map(dependencies.bundles.map((bundle) => [bundle.id, bundle]));
  }

  async resolveResearchProvider(): Promise<ResearchProvider> {
    const { bundle, context } = await this.resolveBundle();
    return bundle.createResearchProvider(context);
  }

  async resolveWatchNewsProvider(): Promise<WatchNewsAnalysisProvider> {
    const { bundle, context } = await this.resolveBundle();
    return bundle.createWatchNewsProvider(context);
  }

  private async resolveBundle(): Promise<{
    bundle: ModelProviderBundleFactory;
    context: ModelProviderContext;
  }> {
    const settings = Object.freeze({ ...await this.dependencies.configStore.getModelProviderSettings() });
    const bundle = this.bundles.get(settings.providerId);
    if (!bundle) {
      throw new Error(`模型服务尚未注册：${settings.providerId}`);
    }

    const secrets = settings.providerId === "deepseek"
      ? await this.dependencies.secretsStore.getSecrets()
      : {};
    if (settings.providerId === "deepseek") {
      if (!secrets.deepSeekApiKey) {
        throw new Error("DeepSeek API Key 尚未配置");
      }
      if (!secrets.tavilyApiKey) {
        throw new Error("Tavily API Key 尚未配置");
      }
    }
    return {
      bundle,
      context: Object.freeze({
        settings,
        secrets: Object.freeze({ ...secrets })
      })
    };
  }
}
