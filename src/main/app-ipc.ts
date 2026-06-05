import { IPC } from "../shared/ipc";
import type {
  AppConfig,
  CodexEnvironmentStatus,
  ResearchRecord,
  WatchTreeConfig
} from "../shared/types";
import { getErrorMessage, type IpcMainLike } from "./ipc-utils";

export interface DialogLike {
  showOpenDialog(options: {
    properties: ["openDirectory"];
  }): Promise<{ canceled: boolean; filePaths: string[] }>;
}

export interface ConfigStoreLike {
  get(): Promise<AppConfig>;
  setReportDirectory(path: string): Promise<AppConfig>;
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
  historyStore: HistoryStoreLike;
  codexLocator: CodexLocatorLike;
  watchTreeStore: WatchTreeStoreLike;
}

export function registerAppIpc(dependencies: AppIpcDependencies): void {
  const {
    ipcMain,
    dialog,
    configStore,
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
