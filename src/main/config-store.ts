import type {
  AppConfig,
  ModelProviderId,
  ModelProviderSettings,
  WatchMarketProviderId
} from "../shared/types";
import { JsonStore } from "./json-store";

export const DEFAULT_MODEL_PROVIDER_SETTINGS: ModelProviderSettings = {
  providerId: "codex-cli",
  deepSeekBaseUrl: "https://api.deepseek.com",
  deepSeekModel: "deepseek-v4-pro"
};

export class ConfigStore {
  private readonly store: JsonStore<AppConfig>;

  constructor(path: string) {
    this.store = new JsonStore(path, () => ({}));
  }

  get(): Promise<AppConfig> {
    return this.store.read();
  }

  async getModelProviderSettings(): Promise<ModelProviderSettings> {
    const config = await this.get();
    return normalizeModelProviderSettings({
      providerId: normalizeProviderId(config.modelProviderId ?? config.researchProviderId),
      deepSeekBaseUrl: config.deepSeekBaseUrl ?? DEFAULT_MODEL_PROVIDER_SETTINGS.deepSeekBaseUrl,
      deepSeekModel: config.deepSeekModel ?? DEFAULT_MODEL_PROVIDER_SETTINGS.deepSeekModel
    });
  }

  async setModelProviderSettings(settings: ModelProviderSettings): Promise<AppConfig> {
    const normalized = normalizeModelProviderSettings(settings);
    const config = {
      ...await this.get(),
      modelProviderId: normalized.providerId,
      deepSeekBaseUrl: normalized.deepSeekBaseUrl,
      deepSeekModel: normalized.deepSeekModel
    };
    await this.store.write(config);
    return config;
  }

  async setReportDirectory(reportDirectory: string): Promise<AppConfig> {
    const config = { ...await this.get(), reportDirectory };
    await this.store.write(config);
    return config;
  }

  async setWatchMarketProviderId(watchMarketProviderId: WatchMarketProviderId): Promise<AppConfig> {
    const config = { ...await this.get(), watchMarketProviderId };
    await this.store.write(config);
    return config;
  }

  async setWatchNewsIntervalHours(watchNewsIntervalHours: number): Promise<AppConfig> {
    if (!Number.isFinite(watchNewsIntervalHours) || watchNewsIntervalHours <= 0) {
      throw new Error("持仓股消息周期必须大于 0 小时");
    }
    const config = { ...await this.get(), watchNewsIntervalHours };
    await this.store.write(config);
    return config;
  }
}

function normalizeProviderId(value: unknown): ModelProviderId {
  return value === "deepseek" ? "deepseek" : "codex-cli";
}

export function normalizeModelProviderSettings(value: ModelProviderSettings): ModelProviderSettings {
  if (value.providerId !== "codex-cli" && value.providerId !== "deepseek") {
    throw new Error("不支持的模型服务");
  }

  const deepSeekModel = value.deepSeekModel.trim();
  if (!deepSeekModel) {
    throw new Error("DeepSeek 模型名称不能为空");
  }

  const deepSeekBaseUrl = normalizeDeepSeekBaseUrl(value.deepSeekBaseUrl);
  return {
    providerId: value.providerId,
    deepSeekBaseUrl,
    deepSeekModel
  };
}

function normalizeDeepSeekBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("DeepSeek Base URL 不是有效的 URL");
  }

  const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(isLocal && url.protocol === "http:")) {
    throw new Error("DeepSeek Base URL 必须使用 HTTPS，本机地址除外");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("DeepSeek Base URL 不能包含凭据、查询参数或片段");
  }

  return url.toString().replace(/\/$/, "");
}
