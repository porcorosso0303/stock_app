interface NavigationEventLike {
  preventDefault(): void;
}

interface WebContentsLike {
  on(
    event: "will-navigate",
    listener: (event: NavigationEventLike, url: string) => void
  ): void;
  setWindowOpenHandler(
    handler: (details: { url: string }) => { action: "deny" }
  ): void;
}

interface WindowLike {
  webContents: WebContentsLike;
}

export function configureExternalLinks(
  window: WindowLike,
  openExternal: (url: string) => Promise<void>
): void {
  window.webContents.on("will-navigate", (event, url) => {
    event.preventDefault();
    openInBrowser(url, openExternal);
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    openInBrowser(url, openExternal);
    return { action: "deny" };
  });
}

function openInBrowser(
  url: string,
  openExternal: (url: string) => Promise<void>
): void {
  if (!isWebUrl(url)) {
    return;
  }
  void openExternal(url).catch(() => {});
}

function isWebUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}
