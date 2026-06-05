import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Windows unpacked deployment script", () => {
  it("preserves user_data while syncing build output with deletion enabled", async () => {
    const script = await readFile("scripts/sync-win-unpacked.sh", "utf8");

    expect(script).toContain("rsync -a --delete");
    expect(script).toContain("--exclude=/user_data/");
  });
});
