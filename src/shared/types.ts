export type ResearchStatus =
  | "running"
  | "completed"
  | "completed_pdf_failed"
  | "failed"
  | "cancelled";

export interface AppConfig {
  reportDirectory?: string;
}

export interface ResearchRecord {
  id: string;
  stockName: string;
  createdAt: string;
  updatedAt: string;
  status: ResearchStatus;
  reportMarkdownPath: string;
  eventsPath: string;
  stderrPath: string;
  pdfPath?: string;
  errorMessage?: string;
}

export interface CodexLauncher {
  kind: "native" | "cmd-wrapper";
  executablePath: string;
}

export interface CodexEnvironmentStatus {
  available: boolean;
  launcher?: CodexLauncher;
  version?: string;
  loggedIn?: boolean;
  repairedUserPath?: boolean;
  message?: string;
}

export interface ResearchProgressEvent {
  type: "output" | "status";
  recordId: string;
  text?: string;
  status?: ResearchStatus;
}

export interface AppBootstrap {
  config: AppConfig;
  history: ResearchRecord[];
  codex: CodexEnvironmentStatus;
}
