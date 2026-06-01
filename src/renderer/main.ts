import "./styles.css";
import { renderMarkdown } from "../shared/render-markdown";
import type {
  AppBootstrap,
  ResearchProgressEvent,
  ResearchRecord
} from "../shared/types";
import {
  canRetryPdf,
  codexStatusMessage,
  initializationErrorMessage,
  primaryActionLabel,
  researchRecordStatusMessage,
  researchStatusLabel,
  sortHistory
} from "./view-model";

const api = window.stockResearch;
const elements = {
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
  liveOutput: getElement<HTMLElement>("live-output")
};

let state: AppBootstrap;
let running = false;
let selectedRecord: ResearchRecord | undefined;

void initialize().catch((error: unknown) => {
  const message = initializationErrorMessage(error);
  elements.codexStatus.textContent = message;
  elements.taskStatus.textContent = message;
});

async function initialize(): Promise<void> {
  bindEvents();
  state = await api.getBootstrap();
  renderBootstrap();
  api.onResearchEvent(handleProgress);
}

function bindEvents(): void {
  elements.primaryAction.addEventListener("click", () => void handlePrimaryAction());
  elements.configureDirectory.addEventListener("click", () => void chooseDirectory());
  elements.redetectCodex.addEventListener("click", () => void redetectCodex());
  elements.refreshHistory.addEventListener("click", () => void refreshHistory());
  elements.openPdf.addEventListener("click", () => void openSelectedPdf());
  elements.retryPdf.addEventListener("click", () => void retrySelectedPdf());
  document.querySelectorAll<HTMLButtonElement>(".tab").forEach((tab) => {
    tab.addEventListener("click", () => selectTab(tab.dataset.tab === "output" ? "output" : "report"));
  });
}

function renderBootstrap(): void {
  elements.reportDirectory.textContent = state.config.reportDirectory ?? "尚未配置";
  elements.codexStatus.textContent = codexStatusMessage(state.codex);
  renderHistory();
  renderPrimaryAction();
}

async function handlePrimaryAction(): Promise<void> {
  if (running) {
    await api.cancelResearch();
    elements.taskStatus.textContent = "正在停止调研...";
    return;
  }

  if (!elements.input.value.trim()) {
    elements.taskStatus.textContent = "请输入A股标的名称";
    elements.input.focus();
    return;
  }

  if (!state.config.reportDirectory && !await chooseDirectory()) {
    elements.taskStatus.textContent = "未选择报告目录，调研未启动";
    return;
  }

  running = true;
  selectedRecord = undefined;
  elements.liveOutput.textContent = "";
  elements.reportPanel.innerHTML = '<div class="empty-state"><h2>正在调研</h2><p>过程输出可在“实时输出”标签页查看。</p></div>';
  selectTab("output");
  renderPrimaryAction();

  try {
    const record = await api.startResearch(elements.input.value);
    elements.taskStatus.textContent = researchRecordStatusMessage(record);
    await refreshHistory(record.id);
  } catch (error) {
    elements.taskStatus.textContent = getErrorMessage(error);
  } finally {
    running = false;
    renderPrimaryAction();
  }
}

async function chooseDirectory(): Promise<string | undefined> {
  const directory = await api.chooseReportDirectory();
  if (directory) {
    state.config.reportDirectory = directory;
    elements.reportDirectory.textContent = directory;
  }
  return directory;
}

async function redetectCodex(): Promise<void> {
  elements.codexStatus.textContent = "正在检测 Codex CLI...";
  state.codex = await api.redetectCodex();
  elements.codexStatus.textContent = codexStatusMessage(state.codex);
}

async function refreshHistory(selectId?: string): Promise<void> {
  state.history = await api.listHistory();
  renderHistory();
  if (selectId) {
    await selectHistory(selectId);
  }
}

function renderHistory(): void {
  const records = sortHistory(state.history);
  if (records.length === 0) {
    elements.historyList.innerHTML = '<p class="muted">暂无调研记录</p>';
    return;
  }
  elements.historyList.innerHTML = records.map((record) => `
    <button class="history-item${record.id === selectedRecord?.id ? " selected" : ""}" data-record-id="${escapeHtml(record.id)}" type="button">
      <strong>${escapeHtml(record.stockName)}</strong>
      <span>${formatDate(record.createdAt)}</span>
      <em>${researchStatusLabel(record.status)}</em>
    </button>
  `).join("");
  elements.historyList.querySelectorAll<HTMLButtonElement>(".history-item").forEach((button) => {
    button.addEventListener("click", () => void selectHistory(button.dataset.recordId ?? ""));
  });
}

async function selectHistory(id: string): Promise<void> {
  selectedRecord = state.history.find((record) => record.id === id);
  if (!selectedRecord) {
    return;
  }
  renderHistory();
  elements.openPdf.hidden = !selectedRecord.pdfPath;
  elements.retryPdf.hidden = !canRetryPdf(selectedRecord);
  if (selectedRecord.status === "completed" || selectedRecord.status === "completed_pdf_failed") {
    elements.reportPanel.innerHTML = renderMarkdown(await api.readReport(id));
    selectTab("report");
  } else {
    elements.reportPanel.innerHTML = `<div class="empty-state"><h2>${researchStatusLabel(selectedRecord.status)}</h2><p>${escapeHtml(selectedRecord.errorMessage ?? "该记录没有可显示的报告。")}</p></div>`;
    selectTab("report");
  }
}

async function openSelectedPdf(): Promise<void> {
  if (selectedRecord?.pdfPath) {
    await api.openPdf(selectedRecord.id);
  }
}

async function retrySelectedPdf(): Promise<void> {
  if (!selectedRecord) {
    return;
  }
  try {
    const record = await api.retryPdf(selectedRecord.id);
    elements.taskStatus.textContent = "PDF 已重新导出";
    await refreshHistory(record.id);
  } catch (error) {
    elements.taskStatus.textContent = getErrorMessage(error);
  }
}

function handleProgress(event: ResearchProgressEvent): void {
  if (event.type === "output" && event.text) {
    elements.liveOutput.textContent += `${event.text}\n`;
    elements.outputPanel.scrollTop = elements.outputPanel.scrollHeight;
  }
  if (event.type === "status" && event.status) {
    elements.taskStatus.textContent = researchStatusLabel(event.status);
  }
}

function renderPrimaryAction(): void {
  elements.primaryAction.textContent = primaryActionLabel(running);
  elements.primaryAction.classList.toggle("danger", running);
}

function selectTab(name: "report" | "output"): void {
  elements.reportPanel.hidden = name !== "report";
  elements.outputPanel.hidden = name !== "output";
  document.querySelectorAll<HTMLButtonElement>(".tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.tab === name);
  });
}

function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing element: ${id}`);
  }
  return element as T;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
