import { describe, expect, it, vi } from "vitest";
import type { MenuItemConstructorOptions } from "electron";
import { buildApplicationMenuTemplate } from "../../src/main/app-menu";

describe("application menu", () => {
  it("adds a Setting data-source entry that opens an independent selector", () => {
    const onOpenWatchMarketProviderSettings = vi.fn();
    const onOpenWatchNewsSettings = vi.fn();
    const onOpenModelProviderSettings = vi.fn();
    const template = buildApplicationMenuTemplate({
      selectedWatchMarketProviderId: "mock-cache",
      onOpenWatchMarketProviderSettings,
      onOpenWatchNewsSettings,
      onOpenModelProviderSettings
    });

    const settingMenu = template.find((item) => item.label === "Setting");
    expect(settingMenu).toBeTruthy();
    const settingSubmenu = settingMenu?.submenu as MenuItemConstructorOptions[] | undefined;
    expect(settingSubmenu?.map((item) => item.label)).toEqual(["数据源", "模型服务", "持仓股消息"]);
    const dataSourceMenu = settingSubmenu?.[0];
    expect(dataSourceMenu?.submenu).toBeUndefined();

    dataSourceMenu?.click?.(undefined as never, undefined as never, undefined as never);
    settingSubmenu?.[1]?.click?.(undefined as never, undefined as never, undefined as never);
    settingSubmenu?.[2]?.click?.(undefined as never, undefined as never, undefined as never);

    expect(onOpenWatchMarketProviderSettings).toHaveBeenCalledOnce();
    expect(onOpenModelProviderSettings).toHaveBeenCalledOnce();
    expect(onOpenWatchNewsSettings).toHaveBeenCalledOnce();
  });
});
