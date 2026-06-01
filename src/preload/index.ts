import { contextBridge, ipcRenderer } from "electron";
import type { StockResearchApi } from "../shared/ipc";
import type { ResearchProgressEvent } from "../shared/types";

const IPC = {
  getBootstrap: "app:get-bootstrap",
  chooseReportDirectory: "config:choose-report-directory",
  getResearchSpec: "research-spec:get",
  saveResearchSpec: "research-spec:save",
  resetResearchSpec: "research-spec:reset",
  startResearch: "research:start",
  cancelResearch: "research:cancel",
  listHistory: "history:list",
  readReport: "history:read-report",
  openPdf: "history:open-pdf",
  retryPdf: "history:retry-pdf",
  redetectCodex: "codex:redetect",
  researchEvent: "research:event"
} as const satisfies typeof import("../shared/ipc").IPC;

const api: StockResearchApi = {
  getBootstrap: async () => await ipcRenderer.invoke(IPC.getBootstrap),
  chooseReportDirectory: async () => await ipcRenderer.invoke(IPC.chooseReportDirectory),
  getResearchSpec: async () => await ipcRenderer.invoke(IPC.getResearchSpec),
  saveResearchSpec: async (spec) => await ipcRenderer.invoke(IPC.saveResearchSpec, { spec }),
  resetResearchSpec: async () => await ipcRenderer.invoke(IPC.resetResearchSpec),
  startResearch: async (stockName) => await ipcRenderer.invoke(IPC.startResearch, { stockName }),
  cancelResearch: async () => await ipcRenderer.invoke(IPC.cancelResearch),
  listHistory: async () => await ipcRenderer.invoke(IPC.listHistory),
  readReport: async (id) => await ipcRenderer.invoke(IPC.readReport, { id }),
  openPdf: async (id) => await ipcRenderer.invoke(IPC.openPdf, { id }),
  retryPdf: async (id) => await ipcRenderer.invoke(IPC.retryPdf, { id }),
  redetectCodex: async () => await ipcRenderer.invoke(IPC.redetectCodex),
  onResearchEvent: (callback) => {
    const listener = (_event: unknown, progress: ResearchProgressEvent) => callback(progress);
    ipcRenderer.on(IPC.researchEvent, listener);
    return () => ipcRenderer.removeListener(IPC.researchEvent, listener);
  }
};

contextBridge.exposeInMainWorld("stockResearch", api);
