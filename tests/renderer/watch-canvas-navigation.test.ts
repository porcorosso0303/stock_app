import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  anchoredWatchCanvasScroll,
  nextWatchCanvasZoom,
  watchCanvasLogicalPoint,
  watchCanvasHorizontalWheelDelta
} from "../../src/renderer/features/watch/watch-controller";

describe("watch canvas navigation", () => {
  it("changes zoom in ten-percent steps and clamps it to 50%-200%", () => {
    expect(nextWatchCanvasZoom(1, -120)).toBe(1.1);
    expect(nextWatchCanvasZoom(1, 120)).toBe(0.9);
    expect(nextWatchCanvasZoom(2, -120)).toBe(2);
    expect(nextWatchCanvasZoom(0.5, 120)).toBe(0.5);
  });

  it("keeps the logical point under the cursor anchored after zoom", () => {
    expect(anchoredWatchCanvasScroll({
      scrollLeft: 200,
      scrollTop: 100,
      pointerX: 300,
      pointerY: 240,
      previousZoom: 1,
      nextZoom: 1.5
    })).toEqual({
      scrollLeft: 450,
      scrollTop: 270
    });
  });

  it("accounts for the scroll container inset when anchoring zoom", () => {
    expect(anchoredWatchCanvasScroll({
      scrollLeft: 200,
      scrollTop: 100,
      pointerX: 300,
      pointerY: 240,
      contentInsetX: 22,
      contentInsetY: 22,
      previousZoom: 1,
      nextZoom: 1.5
    })).toEqual({
      scrollLeft: 439,
      scrollTop: 259
    });
  });

  it("converts a pointer to logical canvas coordinates without including panel padding", () => {
    expect(watchCanvasLogicalPoint(310, 250, { left: 90, top: 50 }, 2)).toEqual({
      x: 110,
      y: 100
    });
  });

  it("uses the dominant wheel delta for shift-horizontal scrolling", () => {
    expect(watchCanvasHorizontalWheelDelta(20, 120)).toBe(120);
    expect(watchCanvasHorizontalWheelDelta(-80, 10)).toBe(-80);
  });

  it("binds wheel navigation without intercepting the ordinary vertical wheel path", async () => {
    const source = await readFile("src/renderer/features/watch/watch-controller.ts", "utf8");

    expect(source).toContain('elements.watchPanel.addEventListener("wheel", handleCanvasWheel');
    expect(source).toContain("if (event.ctrlKey)");
    expect(source).toContain("if (event.shiftKey)");
    expect(source).toContain("watchCanvasZoom = 1");
    expect(source).not.toContain("watchCanvasZoom:");
  });
});
