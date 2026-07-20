import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResearchService } from "../../src/main/research-service";
import { HistoryStore } from "../../src/main/history-store";
import type { CodexRunResult } from "../../src/main/codex-runner";
import { CodexCliResearchProvider } from "../../src/main/modules/research/providers/codex-cli-provider";
import type { ResearchProvider } from "../../src/main/modules/research/providers/research-provider";
import type { ResearchProgressEvent } from "../../src/shared/types";

const directories: string[] = [];

async function createHarness(options: {
  reportDirectory?: string;
  loggedIn?: boolean;
  result?: CodexRunResult;
  exportError?: Error;
  researchProvider?: ResearchProvider;
  resolveResearchProvider?: () => Promise<ResearchProvider>;
  createId?: () => string;
  now?: () => Date;
  onProgress?: (event: ResearchProgressEvent) => void;
} = {}) {
  const userData = await mkdtemp(join(tmpdir(), "stock-tool-service-"));
  directories.push(userData);
  const history = new HistoryStore(join(userData, "history.json"));
  const run = vi.fn().mockResolvedValue(options.result ?? {
    status: "success",
    reportMarkdown: "# 贵州茅台调研"
  });
  const cancel = vi.fn();
  const exportPdf = vi.fn().mockImplementation(async () => {
    if (options.exportError) {
      throw options.exportError;
    }
  });
  const createRunner = vi.fn().mockReturnValue({ run, cancel });
  const prepareSkill = vi.fn().mockResolvedValue(undefined);
  const codexLocator = {
    detect: async () => ({
      available: true,
      loggedIn: options.loggedIn ?? true,
      launcher: { kind: "native" as const, executablePath: "codex.exe" }
    })
  };
  const researchProvider = options.researchProvider ?? new CodexCliResearchProvider({
    codexLocator,
    createRunner,
    researchSkillPreparer: { prepare: prepareSkill }
  });
  const service = new ResearchService({
    userDataDirectory: userData,
    configStore: {
      get: async () => ({ reportDirectory: options.reportDirectory })
    },
    historyStore: history,
    resolveResearchProvider: options.resolveResearchProvider ?? (async () => researchProvider),
    pdfExporter: { export: exportPdf },
    createId: options.createId ?? (() => "run-id"),
    now: options.now ?? (() => new Date(2026, 4, 31, 14, 30, 25)),
    onProgress: options.onProgress
  });
  return { service, history, run, cancel, exportPdf, createRunner, prepareSkill, userData };
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true
  })));
});

describe("ResearchService", () => {
  it("runs research through an injected provider instead of constructing a Codex runner", async () => {
    const provider = {
      id: "fake",
      label: "Fake Provider",
      detect: vi.fn().mockResolvedValue({ available: true, loggedIn: true }),
      run: vi.fn().mockResolvedValue({
        status: "success",
        reportMarkdown: "# Provider report"
      } satisfies CodexRunResult),
      cancel: vi.fn()
    };
    const { service, createRunner, prepareSkill, exportPdf } = await createHarness({
      reportDirectory: "C:\\reports",
      researchProvider: provider
    });

    await expect(service.start("贵州茅台")).resolves.toMatchObject({
      status: "completed"
    });

    expect(provider.run).toHaveBeenCalledWith(expect.objectContaining({
      stockName: "贵州茅台",
      runDirectory: expect.stringContaining("run-id")
    }));
    expect(createRunner).not.toHaveBeenCalled();
    expect(prepareSkill).not.toHaveBeenCalled();
    expect(exportPdf).toHaveBeenCalledWith(
      "# Provider report",
      expect.stringMatching(/贵州茅台_2026-05-31_143025\.pdf$/)
    );
  });

  it("requires a report directory before starting", async () => {
    const { service } = await createHarness();

    await expect(service.start("贵州茅台")).rejects.toThrow("请先选择调研报告目录");
  });

  it("requires a logged-in Codex CLI", async () => {
    const { service } = await createHarness({
      reportDirectory: "C:\\reports",
      loggedIn: false
    });

    await expect(service.start("贵州茅台")).rejects.toThrow("codex login");
  });

  it("completes a research run and records its PDF", async () => {
    const { service, history, exportPdf, createRunner, prepareSkill } = await createHarness({
      reportDirectory: "C:\\reports"
    });

    const result = await service.start(" 贵州茅台 ");

    expect(createRunner).toHaveBeenCalledWith(expect.objectContaining({
      launcher: { kind: "native", executablePath: "codex.exe" },
      runDirectory: expect.stringContaining("run-id")
    }));
    expect(prepareSkill).toHaveBeenCalledWith(expect.stringContaining("run-id"));
    expect(exportPdf).toHaveBeenCalledWith(
      "# 贵州茅台调研",
      expect.stringMatching(/贵州茅台_2026-05-31_143025\.pdf$/)
    );
    expect(result).toMatchObject({
      stockName: "贵州茅台",
      status: "completed",
      pdfPath: expect.stringMatching(/贵州茅台_2026-05-31_143025\.pdf$/)
    });
    await expect(history.get("run-id")).resolves.toMatchObject({ status: "completed" });
  });

  it("does not allow two active runs", async () => {
    let release: (value: CodexRunResult) => void = () => {};
    const { service, run } = await createHarness({ reportDirectory: "C:\\reports" });
    run.mockReturnValue(new Promise<CodexRunResult>((resolve) => {
      release = resolve;
    }));

    const running = service.start("贵州茅台");
    await new Promise((resolve) => setTimeout(resolve, 10));
    await expect(service.start("五粮液")).rejects.toThrow("已有调研任务");
    release({ status: "cancelled" });
    await running;
  });

  it("marks a CLI failure without exporting a PDF", async () => {
    const { service, exportPdf } = await createHarness({
      reportDirectory: "C:\\reports",
      result: { status: "failed", errorMessage: "network error" }
    });

    await expect(service.start("贵州茅台")).resolves.toMatchObject({
      status: "failed",
      errorMessage: "network error"
    });
    expect(exportPdf).not.toHaveBeenCalled();
  });

  it("marks an unexpected runner exception as failed", async () => {
    const { service, run, history } = await createHarness({
      reportDirectory: "C:\\reports"
    });
    run.mockRejectedValue(new Error("spawn failed"));

    await expect(service.start("贵州茅台")).resolves.toMatchObject({
      status: "failed",
      errorMessage: "spawn failed"
    });
    await expect(history.get("run-id")).resolves.toMatchObject({
      status: "failed",
      errorMessage: "spawn failed"
    });
  });

  it("cancels the active runner", async () => {
    let release: (value: CodexRunResult) => void = () => {};
    const { service, run, cancel } = await createHarness({ reportDirectory: "C:\\reports" });
    run.mockReturnValue(new Promise<CodexRunResult>((resolve) => {
      release = resolve;
    }));
    const running = service.start("贵州茅台");
    await new Promise((resolve) => setTimeout(resolve, 10));

    service.cancel();
    release({ status: "cancelled" });

    expect(cancel).toHaveBeenCalledOnce();
    await expect(running).resolves.toMatchObject({ status: "cancelled" });
  });

  it("snapshots one provider for an active task and resolves the next task again", async () => {
    let releaseFirst!: (result: CodexRunResult) => void;
    const firstProvider: ResearchProvider = {
      id: "first",
      label: "First",
      detect: vi.fn().mockResolvedValue({ available: true, loggedIn: true }),
      run: vi.fn().mockReturnValue(new Promise<CodexRunResult>((resolve) => {
        releaseFirst = resolve;
      })),
      cancel: vi.fn()
    };
    const secondProvider: ResearchProvider = {
      id: "second",
      label: "Second",
      detect: vi.fn().mockResolvedValue({ available: true, loggedIn: true }),
      run: vi.fn().mockResolvedValue({ status: "cancelled" }),
      cancel: vi.fn()
    };
    let selectedProvider = firstProvider;
    const resolveResearchProvider = vi.fn(async () => selectedProvider);
    let id = 0;
    const { service } = await createHarness({
      reportDirectory: "C:\\reports",
      resolveResearchProvider,
      createId: () => `run-${++id}`
    });

    const firstRun = service.start("贵州茅台");
    await vi.waitFor(() => expect(firstProvider.run).toHaveBeenCalledOnce());
    selectedProvider = secondProvider;
    service.cancel();

    expect(firstProvider.cancel).toHaveBeenCalledOnce();
    expect(secondProvider.cancel).not.toHaveBeenCalled();
    expect(resolveResearchProvider).toHaveBeenCalledOnce();
    releaseFirst({ status: "cancelled" });
    await firstRun;

    await service.start("五粮液");
    expect(resolveResearchProvider).toHaveBeenCalledTimes(2);
    expect(secondProvider.run).toHaveBeenCalledOnce();
  });

  it("keeps Markdown when PDF export fails and can retry later", async () => {
    const { service, exportPdf } = await createHarness({
      reportDirectory: "C:\\reports",
      exportError: new Error("print failed")
    });

    const failed = await service.start("贵州茅台");
    expect(failed).toMatchObject({
      status: "completed_pdf_failed",
      errorMessage: "print failed"
    });
    exportPdf.mockResolvedValue(undefined);

    await expect(service.retryPdfExport("run-id")).resolves.toMatchObject({
      status: "completed"
    });
  });

  it("timestamps structured output and normalizes the report date to the task date", async () => {
    const onProgress = vi.fn();
    const provider: ResearchProvider = {
      id: "fake",
      label: "Fake",
      detect: async () => ({ available: true, loggedIn: true }),
      run: vi.fn(async (request) => {
        request.onOutput({
          kind: "reasoning",
          mode: "stream",
          text: "核对公告日期"
        });
        return {
          status: "success",
          reportMarkdown: "# 中控技术调研报告\n\n**报告日期：** 2026年7月13日\n"
        } as const;
      }),
      cancel: vi.fn()
    };
    const { service, exportPdf, userData } = await createHarness({
      reportDirectory: "C:\\reports",
      researchProvider: provider,
      onProgress,
      now: () => new Date("2026-07-20T12:34:56.000+08:00")
    });

    await service.start("中控技术");

    expect(provider.run).toHaveBeenCalledWith(expect.objectContaining({
      researchDate: "2026年7月20日"
    }));
    expect(onProgress).toHaveBeenCalledWith({
      type: "output",
      recordId: "run-id",
      outputKind: "reasoning",
      mode: "stream",
      text: "核对公告日期",
      occurredAt: "2026-07-20T04:34:56.000Z"
    });
    const expectedReport = "# 中控技术调研报告\n\n**报告日期：** 2026年7月20日\n";
    await expect(readFile(join(userData, "runs", "run-id", "report.md"), "utf8"))
      .resolves.toBe(expectedReport);
    expect(exportPdf).toHaveBeenCalledWith(expectedReport, expect.any(String));
  });
});
