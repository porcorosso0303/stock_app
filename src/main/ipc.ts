import { IPC } from "../shared/ipc";
import type {
  AppConfig,
  CodexEnvironmentStatus,
  ResearchRecord
} from "../shared/types";

interface IpcMainLike {
  handle(
    channel: string,
    handler: (event: unknown, value?: unknown) => unknown
  ): void;
}

interface DialogLike {
  showOpenDialog(options: {
    properties: ["openDirectory"];
  }): Promise<{ canceled: boolean; filePaths: string[] }>;
}

interface ShellLike {
  openPath(path: string): Promise<string>;
}

interface ConfigStoreLike {
  get(): Promise<AppConfig>;
  setReportDirectory(path: string): Promise<AppConfig>;
}

interface HistoryStoreLike {
  list(): Promise<ResearchRecord[]>;
  get(id: string): Promise<ResearchRecord | undefined>;
}

interface ResearchServiceLike {
  start(stockName: string): Promise<ResearchRecord>;
  cancel(): void;
  readReport(id: string): Promise<string>;
  retryPdfExport(id: string): Promise<ResearchRecord>;
}

interface CodexLocatorLike {
  detect(): Promise<CodexEnvironmentStatus>;
}

interface IpcDependencies {
  ipcMain: IpcMainLike;
  dialog: DialogLike;
  shell: ShellLike;
  configStore: ConfigStoreLike;
  historyStore: HistoryStoreLike;
  researchService: ResearchServiceLike;
  codexLocator: CodexLocatorLike;
}

export function registerIpcHandlers(dependencies: IpcDependencies): void {
  const {
    ipcMain,
    dialog,
    shell,
    configStore,
    historyStore,
    researchService,
    codexLocator
  } = dependencies;

  ipcMain.handle(IPC.getBootstrap, async () => ({
    config: await configStore.get(),
    history: await historyStore.list(),
    codex: await codexLocator.detect()
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

  ipcMain.handle(IPC.startResearch, async (_event, value) => {
    const input = requireObject(value);
    return await researchService.start(requireString(input.stockName, "stockName"));
  });

  ipcMain.handle(IPC.cancelResearch, async () => {
    researchService.cancel();
  });

  ipcMain.handle(IPC.listHistory, async () => await historyStore.list());

  ipcMain.handle(IPC.readReport, async (_event, value) => {
    const input = requireObject(value);
    return await researchService.readReport(requireString(input.id, "id"));
  });

  ipcMain.handle(IPC.openPdf, async (_event, value) => {
    const input = requireObject(value);
    const id = requireString(input.id, "id");
    const record = await historyStore.get(id);
    if (!record?.pdfPath) {
      throw new Error("该历史记录没有可打开的 PDF");
    }
    const errorMessage = await shell.openPath(record.pdfPath);
    if (errorMessage) {
      throw new Error(`打开 PDF 失败：${errorMessage}`);
    }
  });

  ipcMain.handle(IPC.retryPdf, async (_event, value) => {
    const input = requireObject(value);
    return await researchService.retryPdfExport(requireString(input.id, "id"));
  });

  ipcMain.handle(IPC.redetectCodex, async () => await codexLocator.detect());
}

function requireObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("IPC 参数必须是对象");
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string") {
    throw new Error(`IPC 参数 ${name} 必须是字符串`);
  }
  return value;
}
