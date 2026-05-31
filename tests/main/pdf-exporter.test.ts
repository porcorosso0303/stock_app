import { describe, expect, it, vi } from "vitest";
import { PdfExporter } from "../../src/main/pdf-exporter";

describe("PdfExporter", () => {
  it("renders HTML, prints an A4 PDF and writes the target file", async () => {
    const loadURL = vi.fn().mockResolvedValue(undefined);
    const printToPDF = vi.fn().mockResolvedValue(Buffer.from("pdf"));
    const destroy = vi.fn();
    const writeFile = vi.fn().mockResolvedValue(undefined);
    const exporter = new PdfExporter({
      createWindow: () => ({
        loadURL,
        webContents: { printToPDF },
        destroy
      }),
      writeFile
    });

    await exporter.export("# 中文报告", "C:\\reports\\报告.pdf");

    expect(loadURL).toHaveBeenCalledWith(expect.stringMatching(/^data:text\/html;charset=utf-8,/));
    expect(printToPDF).toHaveBeenCalledWith({
      pageSize: "A4",
      printBackground: true
    });
    expect(writeFile).toHaveBeenCalledWith("C:\\reports\\报告.pdf", Buffer.from("pdf"));
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("destroys the hidden window when PDF printing fails", async () => {
    const destroy = vi.fn();
    const exporter = new PdfExporter({
      createWindow: () => ({
        loadURL: vi.fn().mockResolvedValue(undefined),
        webContents: { printToPDF: vi.fn().mockRejectedValue(new Error("print failed")) },
        destroy
      }),
      writeFile: vi.fn()
    });

    await expect(exporter.export("# 报告", "out.pdf")).rejects.toThrow("print failed");
    expect(destroy).toHaveBeenCalledOnce();
  });
});
