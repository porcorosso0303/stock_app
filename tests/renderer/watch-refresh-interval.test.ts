import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("watch refresh interval", () => {
  it("polls watch market data every ten seconds", async () => {
    const controller = await readFile("src/renderer/features/watch/watch-controller.ts", "utf8");

    expect(controller).toContain("setInterval(() => void refreshQuotes(), 10_000)");
    expect(controller).not.toContain("15_000");
  });

  it("does not overlap polling requests while a market update is still running", async () => {
    const controller = await readFile("src/renderer/features/watch/watch-controller.ts", "utf8");

    expect(controller).toContain("let marketUpdateInFlight = false");
    expect(controller).toContain("if (marketUpdateInFlight)");
    expect(controller).toContain("marketUpdateInFlight = true");
    expect(controller).toContain("marketUpdateInFlight = false");
  });
});
