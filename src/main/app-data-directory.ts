import { dirname, join, win32 } from "node:path";

export interface AppDataDirectoryOptions {
  isPackaged: boolean;
  appPath: string;
  executablePath: string;
}

export function resolveAppDataDirectory(options: AppDataDirectoryOptions): string {
  const root = options.isPackaged
    ? executableDirectory(options.executablePath)
    : options.appPath;
  return join(root, "user_data");
}

function executableDirectory(executablePath: string): string {
  return executablePath.includes("\\")
    ? win32.dirname(executablePath)
    : dirname(executablePath);
}
