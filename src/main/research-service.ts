import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  AppConfig,
  ResearchProgressEvent,
  ResearchRecord
} from "../shared/types";
import type { ResearchProvider } from "./modules/research/providers/research-provider";
import { buildPdfFileName, validateStockName } from "./stock-name";

interface ConfigStoreLike {
  get(): Promise<AppConfig>;
}

interface HistoryStoreLike {
  get(id: string): Promise<ResearchRecord | undefined>;
  create(record: ResearchRecord): Promise<void>;
  update(id: string, patch: Partial<ResearchRecord>): Promise<ResearchRecord>;
}

interface PdfExporterLike {
  export(markdown: string, targetPath: string): Promise<void>;
}

export interface ResearchServiceDependencies {
  userDataDirectory: string;
  configStore: ConfigStoreLike;
  historyStore: HistoryStoreLike;
  researchProvider: ResearchProvider;
  pdfExporter: PdfExporterLike;
  createId?: () => string;
  now?: () => Date;
  onProgress?: (event: ResearchProgressEvent) => void;
}

export class ResearchService {
  private readonly createId: () => string;
  private readonly now: () => Date;
  private active?: { record: ResearchRecord; provider: ResearchProvider };

  constructor(public readonly dependencies: ResearchServiceDependencies) {
    this.createId = dependencies.createId ?? randomUUID;
    this.now = dependencies.now ?? (() => new Date());
  }

  async start(stockNameValue: string): Promise<ResearchRecord> {
    if (this.active) {
      throw new Error("已有调研任务正在运行");
    }

    const stockName = validateStockName(stockNameValue);
    const config = await this.dependencies.configStore.get();
    if (!config.reportDirectory) {
      throw new Error("请先选择调研报告目录");
    }

    const providerStatus = await this.dependencies.researchProvider.detect();
    if (!providerStatus.available) {
      throw new Error(providerStatus.message ?? `${this.dependencies.researchProvider.label} 不可用`);
    }
    if (providerStatus.loggedIn === false) {
      throw new Error(
        providerStatus.message
          ?? `${this.dependencies.researchProvider.label} 尚未登录，请先完成登录配置。`
      );
    }

    const id = this.createId();
    const createdAt = this.now();
    const runDirectory = join(this.dependencies.userDataDirectory, "runs", id);
    await mkdir(runDirectory, { recursive: true });
    const record: ResearchRecord = {
      id,
      stockName,
      createdAt: createdAt.toISOString(),
      updatedAt: createdAt.toISOString(),
      status: "running",
      reportMarkdownPath: join(runDirectory, "report.md"),
      eventsPath: join(runDirectory, "events.jsonl"),
      stderrPath: join(runDirectory, "stderr.log")
    };
    await this.dependencies.historyStore.create(record);

    const provider = this.dependencies.researchProvider;
    this.active = { record, provider };
    this.emit({ type: "status", recordId: id, status: "running" });

    try {
      const result = await provider.run({
        stockName,
        runDirectory,
        onOutput: (text) => {
          this.emit({ type: "output", recordId: id, text });
        }
      });
      if (result.status === "cancelled") {
        return await this.updateStatus(id, { status: "cancelled" });
      }
      if (result.status === "failed") {
        return await this.updateStatus(id, {
          status: "failed",
          errorMessage: result.errorMessage
        });
      }

      await writeFile(record.reportMarkdownPath, result.reportMarkdown, "utf8");
      const pdfPath = join(
        config.reportDirectory,
        buildPdfFileName(stockName, createdAt)
      );
      try {
        await this.dependencies.pdfExporter.export(result.reportMarkdown, pdfPath);
        return await this.updateStatus(id, { status: "completed", pdfPath });
      } catch (error) {
        return await this.updateStatus(id, {
          status: "completed_pdf_failed",
          errorMessage: getErrorMessage(error)
        });
      }
    } catch (error) {
      return await this.updateStatus(id, {
        status: "failed",
        errorMessage: getErrorMessage(error)
      });
    } finally {
      this.active = undefined;
    }
  }

  cancel(): void {
    this.active?.provider.cancel();
  }

  async retryPdfExport(id: string): Promise<ResearchRecord> {
    const record = await this.requireRecord(id);
    const config = await this.dependencies.configStore.get();
    if (!config.reportDirectory) {
      throw new Error("请先选择调研报告目录");
    }

    const markdown = await readFile(record.reportMarkdownPath, "utf8");
    const pdfPath = join(
      config.reportDirectory,
      buildPdfFileName(record.stockName, this.now())
    );
    await this.dependencies.pdfExporter.export(markdown, pdfPath);
    return await this.dependencies.historyStore.update(id, {
      status: "completed",
      pdfPath,
      errorMessage: undefined
    });
  }

  async readReport(id: string): Promise<string> {
    const record = await this.requireRecord(id);
    return await readFile(record.reportMarkdownPath, "utf8");
  }

  getActiveRecord(): ResearchRecord | undefined {
    return this.active?.record;
  }

  private async requireRecord(id: string): Promise<ResearchRecord> {
    const record = await this.dependencies.historyStore.get(id);
    if (!record) {
      throw new Error(`未找到历史记录：${id}`);
    }
    return record;
  }

  private async updateStatus(
    id: string,
    patch: Partial<ResearchRecord>
  ): Promise<ResearchRecord> {
    const record = await this.dependencies.historyStore.update(id, patch);
    this.emit({ type: "status", recordId: id, status: record.status });
    return record;
  }

  private emit(event: ResearchProgressEvent): void {
    this.dependencies.onProgress?.(event);
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
