import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CodexWatchNewsAnalysisProvider,
  EastMoneyWatchNewsNoticeSource,
  type WatchNewsNoticeSource
} from "../../src/main/watch-news-analysis-provider";
import type { CodexLauncher } from "../../src/shared/types";

const directories: string[] = [];
const launcher: CodexLauncher = { kind: "native", executablePath: "codex" };

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true
  })));
});

describe("CodexWatchNewsAnalysisProvider", () => {
  it("injects prefetched EastMoney announcement candidates into the model prompt", async () => {
    const userDataDirectory = await createTempDirectory();
    const noticeSource: WatchNewsNoticeSource = {
      listRecent: async () => [{
        title: "兆易创新:兆易创新2026年半年度业绩预增公告",
        sourceName: "东方财富公告",
        sourceUrl: "https://data.eastmoney.com/notices/detail/603986/AN202607091826846840.html",
        occurredAt: "2026-07-09 17:34:03",
        summary: "业绩预告"
      }]
    };
    let capturedPrompt = "";
    const provider = new CodexWatchNewsAnalysisProvider({
      codexLocator: { detect: async () => ({ available: true, loggedIn: true, launcher }) },
      userDataDirectory,
      noticeSource,
      now: () => new Date("2026-07-09T15:10:00.000Z"),
      createRunner: () => ({
        run: async (prompt) => {
          capturedPrompt = prompt;
          return { status: "success", reportMarkdown: "[]" };
        },
        cancel: () => undefined
      })
    });

    await provider.analyze({ secid: "1.603986", stockName: "兆易创新", existingMessages: [] });

    expect(capturedPrompt).toContain("交易所公告/法定信息披露公告");
    expect(capturedPrompt).toContain("兆易创新2026年半年度业绩预增公告");
    expect(capturedPrompt).toContain("AN202607091826846840");
  });

  it("exposes the latest failed Codex run for the debug window", async () => {
    const userDataDirectory = await createTempDirectory();
    const provider = new CodexWatchNewsAnalysisProvider({
      codexLocator: { detect: async () => ({ available: true, loggedIn: true, launcher }) },
      userDataDirectory,
      now: () => new Date("2026-07-09T15:12:00.000Z"),
      createRunner: (options) => ({
        run: async () => {
          await writeFile(
            join(options.runDirectory, "events.jsonl"),
            '{"type":"item.completed","item":{"type":"web_search","query":"兆易创新 603986 财报预告"}}\n',
            "utf8"
          );
          await writeFile(
            join(options.runDirectory, "stderr.log"),
            "failed to connect to websocket",
            "utf8"
          );
          return { status: "failed", errorMessage: "Codex CLI 连接失败" };
        },
        cancel: () => undefined
      })
    });

    await expect(provider.analyze({
      secid: "1.603986",
      stockName: "兆易创新",
      existingMessages: []
    })).rejects.toThrow("Codex CLI 连接失败");

    const debugRun = await provider.getLatestDebugRun("1.603986");

    expect(debugRun?.secid).toBe("1.603986");
    expect(debugRun?.prompt).toContain("兆易创新");
    expect(debugRun?.events.some((event) => event.text.includes("兆易创新 603986 财报预告"))).toBe(true);
    expect(debugRun?.stderr).toContain("failed to connect to websocket");
    expect(debugRun?.errorMessage).toBe("Codex CLI 连接失败");
  });
});

describe("EastMoneyWatchNewsNoticeSource", () => {
  it("reads recent financial forecast announcements from EastMoney notice API", async () => {
    const source = new EastMoneyWatchNewsNoticeSource(async () => ({
      ok: true,
      json: async () => ({
        success: 1,
        data: {
          list: [{
            art_code: "AN202607091826846840",
            title: "兆易创新:兆易创新2026年半年度业绩预增公告",
            display_time: "2026-07-09 17:34:03:717",
            columns: [{ column_name: "业绩预告" }]
          }, {
            art_code: "AN202607061826750248",
            title: "兆易创新:兆易创新关于限制性股票回购注销实施公告",
            display_time: "2026-07-06 18:39:39:553",
            columns: [{ column_name: "回购实施公告" }]
          }]
        }
      })
    }));

    const notices = await source.listRecent(
      { secid: "1.603986", stockName: "兆易创新", existingMessages: [] },
      new Date("2026-07-09T15:10:00.000Z")
    );

    expect(notices).toHaveLength(1);
    expect(notices[0].title).toContain("业绩预增公告");
    expect(notices[0].sourceUrl).toContain("AN202607091826846840");
  });
});

async function createTempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "watch-news-provider-"));
  directories.push(directory);
  return directory;
}
