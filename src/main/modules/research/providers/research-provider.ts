import type { CodexEnvironmentStatus } from "../../../../shared/types";

export type ResearchProviderResult =
  | { status: "success"; reportMarkdown: string }
  | { status: "failed"; errorMessage: string }
  | { status: "cancelled" };

export interface ResearchProviderOutputEvent {
  kind: "status" | "reasoning" | "answer";
  mode: "line" | "stream";
  text: string;
}

export interface ResearchProviderRequest {
  stockName: string;
  runDirectory: string;
  researchDate: string;
  onOutput: (event: ResearchProviderOutputEvent) => void;
}

export interface ResearchProvider {
  readonly id: string;
  readonly label: string;
  detect(): Promise<CodexEnvironmentStatus>;
  run(request: ResearchProviderRequest): Promise<ResearchProviderResult>;
  cancel(): void;
}
