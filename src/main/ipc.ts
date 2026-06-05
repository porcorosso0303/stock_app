import {
  registerAppIpc,
  type AppIpcDependencies
} from "./app-ipc";
import {
  registerResearchIpc,
  type ResearchIpcDependencies
} from "./modules/research/research-ipc";
import {
  registerWatchIpc,
  type WatchIpcDependencies
} from "./modules/watch/watch-ipc";

type IpcDependencies =
  & AppIpcDependencies
  & ResearchIpcDependencies
  & WatchIpcDependencies;

export function registerIpcHandlers(dependencies: IpcDependencies): void {
  registerAppIpc(dependencies);
  registerResearchIpc(dependencies);
  registerWatchIpc(dependencies);
}
