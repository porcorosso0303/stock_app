import { describe, expect, it } from "vitest";
import { resolveEmbeddedSkillDirectory } from "../../src/main/embedded-skill";

describe("resolveEmbeddedSkillDirectory", () => {
  it("uses the repository asset in development", () => {
    expect(resolveEmbeddedSkillDirectory({
      isPackaged: false,
      appPath: "/app",
      resourcesPath: "/resources"
    })).toBe("/app/assets/research-a-share-stock");
  });

  it("uses the unpacked extra resource in a packaged app", () => {
    expect(resolveEmbeddedSkillDirectory({
      isPackaged: true,
      appPath: "/resources/app.asar",
      resourcesPath: "/resources"
    })).toBe("/resources/research-a-share-stock");
  });
});
