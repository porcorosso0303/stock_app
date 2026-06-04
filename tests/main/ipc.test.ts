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
  codexDetectError?: Error;
} = {}) {
  const handlers = new Map<string, (_event: unknown, value?: unknown) => unknown>();
  const setReportDirectory = vi.fn().mockResolvedValue({});
  const setResearchSpec = vi.fn().mockResolvedValue(undefined);
  const resetResearchSpec = vi.fn().mockResolvedValue("default spec");
  const openPath = vi.fn().mockResolvedValue(options.openPathResult ?? "");
  const start = vi.fn().mockResolvedValue(createRecord());
  const setWatchTree = vi.fn().mockImplementation(async (value) => value);
  const listQuotes = vi.fn().mockResolvedValue([]);
  const getWatchMarketData = vi.fn().mockResolvedValue({
    quotes: [],
    trends: [],
    updatedAt: "2026-06-04T00:00:00.000Z",
    fromCache: true
  });
  const refreshWatchMarketData = vi.fn().mockResolvedValue({
    quotes: [],
    trends: [],
    updatedAt: "2026-06-04T00:00:00.000Z",
    fromCache: false
  });
  const searchStocks = vi.fn().mockResolvedValue([]);
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
    researchSpecStore: {
      get: async () => "current spec",
      set: setResearchSpec,
      reset: resetResearchSpec
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
      detect: async () => {
        if (options.codexDetectError) {
          throw options.codexDetectError;
        }
        return { available: false };
      }
    },
    watchTreeStore: {
      get: async () => ({}),
      set: setWatchTree
    },
    quoteService: {
      list: listQuotes,
      search: searchStocks
    },
    watchMarketService: {
      get: getWatchMarketData,
      refresh: refreshWatchMarketData
    }
  });

  const invoke = async (channel: string, value?: unknown) => {
    const handler = handlers.get(channel);
    if (!handler) {
      throw new Error(`Missing handler: ${channel}`);
    }
    return await handler({}, value);
  };
  return {
    invoke,
    setReportDirectory,
    setResearchSpec,
    resetResearchSpec,
    openPath,
    start,
    setWatchTree,
    listQuotes,
    getWatchMarketData,
    refreshWatchMarketData,
    searchStocks
  };
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

  it("reads and saves the user-maintained research spec", async () => {
    const { invoke, setResearchSpec } = createHarness();

    await expect(invoke(IPC.getResearchSpec)).resolves.toBe("current spec");
    await expect(invoke(IPC.saveResearchSpec, { spec: "updated spec" })).resolves.toBeUndefined();
    expect(setResearchSpec).toHaveBeenCalledWith("updated spec");
  });

  it("resets the user-maintained research spec to the embedded default", async () => {
    const { invoke, resetResearchSpec } = createHarness();

    await expect(invoke(IPC.resetResearchSpec)).resolves.toBe("default spec");
    expect(resetResearchSpec).toHaveBeenCalledOnce();
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

  it("returns a visible Codex status when detection fails", async () => {
    const { invoke } = createHarness({
      codexDetectError: new Error("PowerShell blocked")
    });

    await expect(invoke(IPC.getBootstrap)).resolves.toMatchObject({
      codex: {
        available: false,
        message: expect.stringContaining("PowerShell blocked")
      }
    });
  });

  it("saves the user-maintained watch tree", async () => {
    const { invoke, setWatchTree } = createHarness();
    const config = {
      root: { id: "root", type: "category", name: "科技股", children: [] }
    };

    await expect(invoke(IPC.saveWatchTree, { config })).resolves.toEqual(config);
    expect(setWatchTree).toHaveBeenCalledWith(config);
  });

  it("rejects invalid quote arguments", async () => {
    const { invoke, listQuotes } = createHarness();

    await expect(invoke(IPC.getWatchQuotes, { secids: "1.600519" }))
      .rejects.toThrow("secids");
    expect(listQuotes).not.toHaveBeenCalled();
  });

  it("gets cached watch market data through validated secids", async () => {
    const { invoke, getWatchMarketData } = createHarness();

    await expect(invoke(IPC.getWatchMarketData, { secids: ["1.600519"] }))
      .resolves.toMatchObject({ fromCache: true });
    expect(getWatchMarketData).toHaveBeenCalledWith(["1.600519"]);
    await expect(invoke(IPC.getWatchMarketData, { secids: "1.600519" }))
      .rejects.toThrow("secids");
  });

  it("refreshes watch market data through validated secids", async () => {
    const { invoke, refreshWatchMarketData } = createHarness();

    await expect(invoke(IPC.refreshWatchMarketData, { secids: ["1.600519"] }))
      .resolves.toMatchObject({ fromCache: false });
    expect(refreshWatchMarketData).toHaveBeenCalledWith(["1.600519"]);
    await expect(invoke(IPC.refreshWatchMarketData, { secids: [123] }))
      .rejects.toThrow("secids");
  });

  it("searches stocks by a validated string argument", async () => {
    const { invoke, searchStocks } = createHarness();

    await expect(invoke(IPC.searchStocks, { query: "贵州茅台" })).resolves.toEqual([]);
    expect(searchStocks).toHaveBeenCalledWith("贵州茅台");
    await expect(invoke(IPC.searchStocks, { query: 123 })).rejects.toThrow("query");
  });
});
