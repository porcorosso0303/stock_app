export const elements = {
  input: getElement<HTMLInputElement>("stock-name"),
  primaryAction: getElement<HTMLButtonElement>("primary-action"),
  taskStatus: getElement<HTMLElement>("task-status"),
  codexStatus: getElement<HTMLElement>("codex-status"),
  redetectCodex: getElement<HTMLButtonElement>("redetect-codex"),
  refreshHistory: getElement<HTMLButtonElement>("refresh-history"),
  historyList: getElement<HTMLElement>("history-list"),
  reportDirectory: getElement<HTMLElement>("report-directory"),
  configureDirectory: getElement<HTMLButtonElement>("configure-directory"),
  openPdf: getElement<HTMLButtonElement>("open-pdf"),
  retryPdf: getElement<HTMLButtonElement>("retry-pdf"),
  reportPanel: getElement<HTMLElement>("report-panel"),
  outputPanel: getElement<HTMLElement>("output-panel"),
  liveOutputScroll: getElement<HTMLElement>("live-output-scroll"),
  liveOutput: getElement<HTMLElement>("live-output"),
  workingIndicator: getElement<HTMLElement>("working-indicator"),
  workingElapsed: getElement<HTMLElement>("working-elapsed"),
  specPanel: getElement<HTMLElement>("spec-panel"),
  researchSpec: getElement<HTMLTextAreaElement>("research-spec"),
  saveSpec: getElement<HTMLButtonElement>("save-spec"),
  resetSpec: getElement<HTMLButtonElement>("reset-spec"),
  specStatus: getElement<HTMLElement>("spec-status"),
  researchSidebarContent: getElement<HTMLElement>("research-sidebar-content"),
  researchWorkspace: getElement<HTMLElement>("research-workspace"),
  watchWorkspace: getElement<HTMLElement>("watch-workspace"),
  watchStatus: getElement<HTMLElement>("watch-status"),
  refreshWatchQuotes: getElement<HTMLButtonElement>("refresh-watch-quotes"),
  watchPanel: getElement<HTMLElement>("watch-panel"),
  watchTree: getElement<HTMLElement>("watch-tree"),
  watchContextMenu: getElement<HTMLElement>("watch-context-menu"),
  watchNodeDialog: getElement<HTMLDialogElement>("watch-node-dialog"),
  watchNodeForm: getElement<HTMLFormElement>("watch-node-form"),
  watchNodeDialogTitle: getElement<HTMLElement>("watch-node-dialog-title"),
  watchNodeType: getElement<HTMLSelectElement>("watch-node-type"),
  watchNodeName: getElement<HTMLInputElement>("watch-node-name"),
  searchWatchStock: getElement<HTMLButtonElement>("search-watch-stock"),
  watchStockResults: getElement<HTMLElement>("watch-stock-results"),
  watchNodeSecidLabel: getElement<HTMLElement>("watch-node-secid-label"),
  watchNodeSecid: getElement<HTMLInputElement>("watch-node-secid"),
  watchNodeError: getElement<HTMLElement>("watch-node-error"),
  cancelWatchNode: getElement<HTMLButtonElement>("cancel-watch-node")
};

export type RendererElements = typeof elements;

function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing element: ${id}`);
  }
  return element as T;
}
