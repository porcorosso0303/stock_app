import { describe, expect, it, vi } from "vitest";
import { registerIpcHandlers } from "../../src/main/ipc";
import { IPC } from "../../src/shared/ipc";
import type { ResearchRecord } from "../../src/shared/types";

function createRecord(): ResearchRecord {
  return {
    id: "record-id",
    stockName: "贵州茅台",
    createdAt: "2026-05-31T00:00:00.000Z",
    updatedAt: "2026-05-31T00:00:00.000Z",
    status: "completed",
    reportMarkdownPath: "report.md",
    eventsPath: "events.jsonl",
    stderrPath: "stderr.log",
    pdfPath: "C:\\reports\\贵州茅台.pdf"
  };
}

function createHarness(options: {
  dialogResult?: string;
  openPathResult?: string;
  record?: ResearchRecord;
} = {}) {
  const handlers = new Map<string, (_event: unknown, value?: unknown) => unknown>();
  const setReportDirectory = vi.fn().mockResolvedValue({});
  const openPath = vi.fn().mockResolvedValue(options.openPathResult ?? "");
  const start = vi.fn().mockResolvedValue(createRecord());
  registerIpcHandlers({
    ipcMain: {
      handle: (channel, handler) => {
        handlers.set(channel, handler);
      }
    },
    dialog: {
      showOpenDialog: vi.fn().mockResolvedValue(options.dialogResult
        ? { canceled: false, filePaths: [options.dialogResult] }
        : { canceled: true, filePaths: [] })
    },
    shell: { openPath },
    configStore: {
      get: async () => ({}),
      setReportDirectory
    },
    historyStore: {
      list: async () => [],
      get: async () => options.record
    },
    researchService: {
      start,
      cancel: vi.fn(),
      readReport: vi.fn(),
      retryPdfExport: vi.fn()
    },
    codexLocator: {
      detect: async () => ({ available: false })
    }
  });

  const invoke = async (channel: string, value?: unknown) => {
    const handler = handlers.get(channel);
    if (!handler) {
      throw new Error(`Missing handler: ${channel}`);
    }
    return await handler({}, value);
  };
  return { invoke, setReportDirectory, openPath, start };
}

describe("registerIpcHandlers", () => {
  it("persists a directory selected through an openDirectory dialog", async () => {
    const { invoke, setReportDirectory } = createHarness({
      dialogResult: "C:\\reports"
    });

    await expect(invoke(IPC.chooseReportDirectory)).resolves.toBe("C:\\reports");
    expect(setReportDirectory).toHaveBeenCalledWith("C:\\reports");
  });

  it("returns undefined when directory selection is cancelled", async () => {
    const { invoke, setReportDirectory } = createHarness();

    await expect(invoke(IPC.chooseReportDirectory)).resolves.toBeUndefined();
    expect(setReportDirectory).not.toHaveBeenCalled();
  });

  it("rejects an invalid research argument", async () => {
    const { invoke, start } = createHarness();

    await expect(invoke(IPC.startResearch, { stockName: 123 })).rejects.toThrow("stockName");
    expect(start).not.toHaveBeenCalled();
  });

  it("opens only a PDF from a known history record", async () => {
    const record = createRecord();
    const { invoke, openPath } = createHarness({ record });

    await invoke(IPC.openPdf, { id: record.id });

    expect(openPath).toHaveBeenCalledWith(record.pdfPath);
  });

  it("turns shell.openPath errors into failures", async () => {
    const record = createRecord();
    const { invoke } = createHarness({ record, openPathResult: "not found" });

    await expect(invoke(IPC.openPdf, { id: record.id })).rejects.toThrow("not found");
  });
});
