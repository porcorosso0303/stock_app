import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { resolveAppDataDirectory } from "../../src/main/app-data-directory";

describe("resolveAppDataDirectory", () => {
  it("uses the project root in development", () => {
    expect(resolveAppDataDirectory({
      isPackaged: false,
      appPath: "/repo",
      executablePath: "/repo/node_modules/electron/dist/electron"
    })).toBe(join("/repo", "user_data"));
  });

  it("uses the executable directory when packaged", () => {
    expect(resolveAppDataDirectory({
      isPackaged: true,
      appPath: "C:\\Program Files\\A股调研助手\\resources\\app.asar",
      executablePath: "C:\\Apps\\A股调研助手\\A股调研助手.exe"
    })).toBe(join("C:\\Apps\\A股调研助手", "user_data"));
  });
});
