import { join } from "node:path";

export function resolveEmbeddedSkillDirectory(options: {
  isPackaged: boolean;
  appPath: string;
  resourcesPath: string;
}): string {
  return options.isPackaged
    ? join(options.resourcesPath, "research-a-share-stock")
    : join(options.appPath, "assets", "research-a-share-stock");
}
