export const CODEX_EXEC_ARGS = [
  "--search",
  "-s",
  "read-only",
  "-a",
  "never",
  "exec",
  "--json",
  "--skip-git-repo-check",
  "-o",
  "report.md",
  "-"
] as const;

export function buildResearchPrompt(stockName: string): string {
  return [
    "使用 $research-a-share-stock skill 对下面指定的单只 A 股标的执行深度调研。",
    `标的名称：${stockName}`,
    "",
    "严格遵循该 skill 的调研规范，优先引用官方和当前公开来源，并标注来源链接与日期。",
    "将最终回复写成一份完整 Markdown 调研报告。",
    "只进行联网调研和只读信息收集。不要修改、创建或删除任何项目文件或用户文件。",
    "不要输出个性化投资建议或绝对买卖指令。"
  ].join("\n");
}
