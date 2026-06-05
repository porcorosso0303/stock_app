import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { getCodexLauncherOverride } from "../../src/main/codex-launcher-override";
import { CodexRunner } from "../../src/main/codex-runner";
import { ConfigStore } from "../../src/main/config-store";
import { HistoryStore } from "../../src/main/history-store";
import { CodexCliResearchProvider } from "../../src/main/modules/research/providers/codex-cli-provider";
import { ResearchService } from "../../src/main/research-service";

const fixture = resolve("tests/fixtures/fake-codex.cjs");
const directories: string[] = [];

beforeAll(async () => {
  await chmod(fixture, 0o755);
});

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true
  })));
});

describe("getCodexLauncherOverride", () => {
  it("uses an executable only when the development environment variable is set", () => {
    expect(getCodexLauncherOverride({})).toBeUndefined();
    expect(getCodexLauncherOverride({
      STOCK_TOOL_CODEX_EXECUTABLE: "C:\\tools\\fake-codex.exe"
    })).toEqual({
      kind: "native",
      executablePath: "C:\\tools\\fake-codex.exe"
    });
  });
});

describe("fake Codex integration", () => {
  it("runs from service to persisted report, logs and exported PDF", async () => {
    const userData = await mkdtemp(join(tmpdir(), "stock-tool-integration-"));
    const reports = await mkdtemp(join(tmpdir(), "stock-tool-reports-"));
    directories.push(userData, reports);
    const config = new ConfigStore(join(userData, "config.json"));
    const history = new HistoryStore(join(userData, "history.json"));
    await config.setReportDirectory(reports);
    const events: string[] = [];
    const researchProvider = new CodexCliResearchProvider({
      codexLocator: {
        detect: async () => ({
          available: true,
          loggedIn: true,
          launcher: { kind: "native", executablePath: fixture }
        })
      },
      createRunner: (options) => new CodexRunner(options),
      researchSkillPreparer: {
        prepare: async () => {}
      }
    });
    const service = new ResearchService({
      userDataDirectory: userData,
      configStore: config,
      historyStore: history,
      researchProvider,
      pdfExporter: {
        export: async (_markdown, targetPath) => {
          await writeFile(targetPath, "%PDF-FAKE", "utf8");
        }
      },
      createId: () => "integration-run",
      now: () => new Date(2026, 4, 31, 14, 30, 25),
      onProgress: (event) => {
        if (event.text) {
          events.push(event.text);
        }
      }
    });

    const record = await service.start("贵州茅台");

    expect(record).toMatchObject({ status: "completed", stockName: "贵州茅台" });
    await expect(readFile(record.reportMarkdownPath, "utf8")).resolves.toContain("# 调研报告");
    await expect(readFile(record.eventsPath, "utf8")).resolves.toContain("完成调研");
    await expect(readFile(join(userData, "runs", "integration-run", "prompt.txt"), "utf8"))
      .resolves.toContain("$research-a-share-stock");
    await expect(readFile(record.pdfPath!, "utf8")).resolves.toBe("%PDF-FAKE");
    expect(events).toEqual(["开始调研", "完成调研"]);
  });
});
