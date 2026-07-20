import { IPC } from "../shared/ipc";
import type {
  AppConfig,
  CodexEnvironmentStatus,
  ModelProviderSettings,
  ModelProviderSettingsView,
  ResearchRecord,
  WatchTreeConfig
} from "../shared/types";
import { normalizeModelProviderSettings } from "./config-store";
import type { ModelSecretsStatus, ModelSecretsUpdate } from "./model-secrets-store";
import {
  getErrorMessage,
  requireObject,
  requireString,
  type IpcMainLike
} from "./ipc-utils";

export interface DialogLike {
  showOpenDialog(options: {
    properties: ["openDirectory"];
  }): Promise<{ canceled: boolean; filePaths: string[] }>;
}

export interface ConfigStoreLike {
  get(): Promise<AppConfig>;
  setReportDirectory(path: string): Promise<AppConfig>;
  getModelProviderSettings(): Promise<ModelProviderSettings>;
  setModelProviderSettings(settings: ModelProviderSettings): Promise<AppConfig>;
}

export interface ModelSecretsStoreLike {
  getStatus(): Promise<ModelSecretsStatus>;
  update(update: ModelSecretsUpdate): Promise<void>;
}

export interface HistoryStoreLike {
  list(): Promise<ResearchRecord[]>;
}

export interface CodexLocatorLike {
  detect(): Promise<CodexEnvironmentStatus>;
}

export interface WatchTreeStoreLike {
  get(): Promise<WatchTreeConfig>;
}

export interface AppIpcDependencies {
  ipcMain: IpcMainLike;
  dialog: DialogLike;
  configStore: ConfigStoreLike;
  modelSecretsStore: ModelSecretsStoreLike;
  historyStore: HistoryStoreLike;
  codexLocator: CodexLocatorLike;
  watchTreeStore: WatchTreeStoreLike;
}

export function registerAppIpc(dependencies: AppIpcDependencies): void {
  const {
    ipcMain,
    dialog,
    configStore,
    modelSecretsStore,
    historyStore,
    codexLocator,
    watchTreeStore
  } = dependencies;

  ipcMain.handle(IPC.getBootstrap, async () => ({
    config: await configStore.get(),
    history: await historyStore.list(),
    codex: await detectCodexSafely(codexLocator),
    watchTree: await watchTreeStore.get()
  }));

  ipcMain.handle(IPC.chooseReportDirectory, async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    const path = result.filePaths[0];
    if (result.canceled || !path) {
      return undefined;
    }
    await configStore.setReportDirectory(path);
    return path;
  });

  ipcMain.handle(IPC.redetectCodex, async () => await detectCodexSafely(codexLocator));

  ipcMain.handle(IPC.getModelProviderSettings, async (): Promise<ModelProviderSettingsView> => ({
    ...await configStore.getModelProviderSettings(),
    ...await modelSecretsStore.getStatus()
  }));

  ipcMain.handle(IPC.setModelProviderSettings, async (_event, value): Promise<ModelProviderSettingsView> => {
    const input = requireObject(value);
    const settings = normalizeModelProviderSettings({
      providerId: requireString(input.providerId, "providerId") as ModelProviderSettings["providerId"],
      deepSeekBaseUrl: requireString(input.deepSeekBaseUrl, "deepSeekBaseUrl"),
      deepSeekModel: requireString(input.deepSeekModel, "deepSeekModel"),
      deepSeekReasoningEffort: requireString(
        input.deepSeekReasoningEffort,
        "deepSeekReasoningEffort"
      ) as ModelProviderSettings["deepSeekReasoningEffort"]
    });
    const deepSeekApiKey = optionalString(input.deepSeekApiKey, "deepSeekApiKey");
    const tavilyApiKey = optionalString(input.tavilyApiKey, "tavilyApiKey");
    const clearDeepSeekApiKey = input.clearDeepSeekApiKey === true;
    const clearTavilyApiKey = input.clearTavilyApiKey === true;
    const currentSecretStatus = await modelSecretsStore.getStatus();
    const nextSecretStatus = {
      hasDeepSeekApiKey: Boolean(deepSeekApiKey)
        || (!clearDeepSeekApiKey && currentSecretStatus.hasDeepSeekApiKey),
      hasTavilyApiKey: Boolean(tavilyApiKey)
        || (!clearTavilyApiKey && currentSecretStatus.hasTavilyApiKey)
    };
    requireDeepSeekSecrets(settings, nextSecretStatus);
    await modelSecretsStore.update({
      deepSeekApiKey,
      tavilyApiKey,
      clearDeepSeekApiKey,
      clearTavilyApiKey
    });
    const secretStatus = await modelSecretsStore.getStatus();
    await configStore.setModelProviderSettings(settings);
    return { ...settings, ...secretStatus };
  });
}

function requireDeepSeekSecrets(
  settings: ModelProviderSettings,
  status: ModelSecretsStatus
): void {
  if (settings.providerId !== "deepseek") return;
  if (!status.hasDeepSeekApiKey) {
    throw new Error("请选择 DeepSeek 前先配置 DeepSeek API Key");
  }
  if (!status.hasTavilyApiKey) {
    throw new Error("请选择 DeepSeek 前先配置 Tavily API Key");
  }
}

function optionalString(value: unknown, name: string): string | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }
  return requireString(value, name);
}

async function detectCodexSafely(
  codexLocator: CodexLocatorLike
): Promise<CodexEnvironmentStatus> {
  try {
    return await codexLocator.detect();
  } catch (error) {
    return {
      available: false,
      message: `检测 Codex CLI 失败：${getErrorMessage(error)}`
    };
  }
}
