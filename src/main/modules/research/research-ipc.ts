import { IPC } from "../../../shared/ipc";
import type { ResearchRecord } from "../../../shared/types";
import {
  requireObject,
  requireString,
  type IpcMainLike
} from "../../ipc-utils";

export interface ShellLike {
  openPath(path: string): Promise<string>;
}

export interface ResearchSpecStoreLike {
  get(): Promise<string>;
  set(spec: string): Promise<void>;
  reset(): Promise<string>;
}

export interface HistoryStoreLike {
  list(): Promise<ResearchRecord[]>;
  get(id: string): Promise<ResearchRecord | undefined>;
}

export interface ResearchServiceLike {
  start(stockName: string): Promise<ResearchRecord>;
  cancel(): void;
  readReport(id: string): Promise<string>;
  retryPdfExport(id: string): Promise<ResearchRecord>;
}

export interface ResearchIpcDependencies {
  ipcMain: IpcMainLike;
  shell: ShellLike;
  researchSpecStore: ResearchSpecStoreLike;
  historyStore: HistoryStoreLike;
  researchService: ResearchServiceLike;
}

export function registerResearchIpc(dependencies: ResearchIpcDependencies): void {
  const {
    ipcMain,
    shell,
    researchSpecStore,
    historyStore,
    researchService
  } = dependencies;

  ipcMain.handle(IPC.getResearchSpec, async () => await researchSpecStore.get());

  ipcMain.handle(IPC.saveResearchSpec, async (_event, value) => {
    const input = requireObject(value);
    await researchSpecStore.set(requireString(input.spec, "spec"));
  });

  ipcMain.handle(IPC.resetResearchSpec, async () => await researchSpecStore.reset());

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
}
