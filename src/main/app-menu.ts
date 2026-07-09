import type { MenuItemConstructorOptions } from "electron";
import type { WatchMarketProviderId } from "../shared/types";

interface ApplicationMenuOptions {
  selectedWatchMarketProviderId: WatchMarketProviderId;
  onOpenWatchMarketProviderSettings(): void;
  onOpenWatchNewsSettings(): void;
}

export function buildApplicationMenuTemplate(
  options: ApplicationMenuOptions
): MenuItemConstructorOptions[] {
  return [{
    label: "File",
    submenu: [{ role: "quit" }]
  }, {
    label: "Setting",
    submenu: [
      {
        label: "数据源",
        click: () => options.onOpenWatchMarketProviderSettings()
      },
      {
        label: "持仓股消息",
        click: () => options.onOpenWatchNewsSettings()
      }
    ]
  }, {
    label: "View",
    submenu: [
      { role: "reload" },
      { role: "toggleDevTools" },
      { type: "separator" },
      { role: "resetZoom" },
      { role: "zoomIn" },
      { role: "zoomOut" }
    ]
  }, {
    label: "Window",
    submenu: [{ role: "minimize" }, { role: "close" }]
  }];
}
