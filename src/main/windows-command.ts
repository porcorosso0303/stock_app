export function buildTrustedCmdWrapperInvocation(
  executablePath: string,
  args: readonly string[]
): string {
  if (executablePath.includes('"') || args.some((arg) => /[\s"&|<>^]/.test(arg))) {
    throw new Error("Codex wrapper 路径或固定参数包含不支持的 cmd.exe 字符");
  }
  return `"${executablePath}" ${args.join(" ")}`;
}

export function buildCmdWrapperCommand(
  executablePath: string,
  args: readonly string[],
  comSpec = "cmd.exe"
): { file: string; args: string[] } {
  return {
    file: comSpec,
    args: [
      "/d",
      "/s",
      "/c",
      buildTrustedCmdWrapperInvocation(executablePath, args)
    ]
  };
}
