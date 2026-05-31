import { contextBridge, ipcRenderer } from "electron";
import { IPC, type StockResearchApi } from "../shared/ipc";
import type { ResearchProgressEvent } from "../shared/types";

const api: StockResearchApi = {
  getBootstrap: async () => await ipcRenderer.invoke(IPC.getBootstrap),
  chooseReportDirectory: async () => await ipcRenderer.invoke(IPC.chooseReportDirectory),
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
