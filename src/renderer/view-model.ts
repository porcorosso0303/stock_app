import type {
  CodexEnvironmentStatus,
  ResearchRecord,
  ResearchStatus
} from "../shared/types";

export function primaryActionLabel(running: boolean): string {
  return running ? "停止调研" : "调研";
}

export function sortHistory(records: ResearchRecord[]): ResearchRecord[] {
  return [...records].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function canRetryPdf(record?: ResearchRecord): boolean {
  return record?.status === "completed_pdf_failed";
}

export function codexStatusMessage(status: CodexEnvironmentStatus): string {
  if (!status.available) {
    return "未检测到 Codex CLI，请先安装后重新检测。";
  }
  if (!status.loggedIn) {
    return "Codex CLI 尚未登录，请在终端执行 codex login。";
  }
  const repaired = status.repairedUserPath ? "，已自动加入当前用户 PATH" : "";
  return `Codex 已就绪：${status.version ?? "版本未知"}${repaired}`;
}

export function initializationErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `应用初始化失败：${message}`;
}

export function researchStatusLabel(status: ResearchStatus): string {
  return {
    running: "调研中",
    completed: "已完成",
    completed_pdf_failed: "报告完成，PDF 导出失败",
    failed: "调研失败",
    cancelled: "已取消"
  }[status];
}

export function researchRecordStatusMessage(record: ResearchRecord): string {
  const label = researchStatusLabel(record.status);
  return record.errorMessage ? `${label}：${record.errorMessage}` : label;
}
