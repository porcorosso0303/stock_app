import { writeFile } from "node:fs/promises";
import { renderReportHtml } from "../shared/render-markdown";

interface PdfWindow {
  loadURL(url: string): Promise<void>;
  webContents: {
    printToPDF(options: {
      pageSize: "A4";
      printBackground: true;
    }): Promise<Buffer>;
  };
  destroy(): void;
}

interface PdfExporterOptions {
  createWindow: () => PdfWindow;
  writeFile?: (path: string, data: Buffer) => Promise<void>;
}

export class PdfExporter {
  private readonly writeFile: (path: string, data: Buffer) => Promise<void>;

  constructor(private readonly options: PdfExporterOptions) {
    this.writeFile = options.writeFile ?? writeFile;
  }

  async export(reportMarkdown: string, targetPath: string): Promise<void> {
    const window = this.options.createWindow();
    try {
      const html = renderReportHtml(reportMarkdown);
      await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      const data = await window.webContents.printToPDF({
        pageSize: "A4",
        printBackground: true
      });
      await this.writeFile(targetPath, data);
    } finally {
      window.destroy();
    }
  }
}
