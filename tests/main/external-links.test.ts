import { describe, expect, it, vi } from "vitest";
import { configureExternalLinks } from "../../src/main/external-links";

function createHarness() {
  let navigate: ((event: { preventDefault(): void }, url: string) => void) | undefined;
  let openWindow: ((details: { url: string }) => { action: "deny" }) | undefined;
  const openExternal = vi.fn().mockResolvedValue(undefined);
  configureExternalLinks({
    webContents: {
      on: (_event, listener) => {
        navigate = listener;
      },
      setWindowOpenHandler: (handler) => {
        openWindow = handler;
      }
    }
  }, openExternal);
  return { getNavigate: () => navigate!, getOpenWindow: () => openWindow!, openExternal };
}

describe("configureExternalLinks", () => {
  it("opens report links in the system browser and keeps the app page", () => {
    const { getNavigate, openExternal } = createHarness();
    const preventDefault = vi.fn();

    getNavigate()({ preventDefault }, "https://example.com/report");

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(openExternal).toHaveBeenCalledWith("https://example.com/report");
  });

  it("denies new Electron windows and opens web URLs externally", () => {
    const { getOpenWindow, openExternal } = createHarness();

    expect(getOpenWindow()({ url: "http://example.com" })).toEqual({ action: "deny" });
    expect(openExternal).toHaveBeenCalledWith("http://example.com");
  });

  it("blocks non-web navigation without opening another application", () => {
    const { getNavigate, openExternal } = createHarness();
    const preventDefault = vi.fn();

    getNavigate()({ preventDefault }, "file:///tmp/report");

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(openExternal).not.toHaveBeenCalled();
  });
});
