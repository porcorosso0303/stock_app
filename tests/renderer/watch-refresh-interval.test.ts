import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("watch refresh interval", () => {
  it("polls watch market data every ten seconds", async () => {
    const controller = await readFile("src/renderer/features/watch/watch-controller.ts", "utf8");

    expect(controller).toContain("setInterval(() => void refreshQuotes(), 10_000)");
    expect(controller).not.toContain("15_000");
  });
});
