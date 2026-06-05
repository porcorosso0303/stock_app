import type { CodexEnvironmentStatus } from "../../../../shared/types";

export type ResearchProviderResult =
  | { status: "success"; reportMarkdown: string }
  | { status: "failed"; errorMessage: string }
  | { status: "cancelled" };

export interface ResearchProviderRequest {
  stockName: string;
  runDirectory: string;
  onOutput: (text: string) => void;
}

export interface ResearchProvider {
  readonly id: string;
  readonly label: string;
  detect(): Promise<CodexEnvironmentStatus>;
  run(request: ResearchProviderRequest): Promise<ResearchProviderResult>;
  cancel(): void;
}
