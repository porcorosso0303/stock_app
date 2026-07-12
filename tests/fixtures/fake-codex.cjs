#!/usr/bin/env node
const { readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

const prompt = readFileSync(0, "utf8");
{
  writeFileSync(join(process.cwd(), "prompt.txt"), prompt, "utf8");
  const mode = process.env.FAKE_CODEX_MODE ?? "success";

  if (mode === "failure") {
    writeFileSync(2, "network error\n");
    process.exitCode = 1;
    return;
  }

  if (mode === "slow") {
    writeFileSync(1, '{"text":"等待取消"}\n');
    setInterval(() => {}, 1000);
    return;
  }

  if (mode === "progress-success") {
    const progress = setInterval(() => {
      writeFileSync(1, '{"text":"持续分析中"}\n');
    }, 15);
    setTimeout(() => {
      clearInterval(progress);
      writeFileSync(join(process.cwd(), "report.md"), "# 调研报告\n\n完成", "utf8");
      process.exitCode = 0;
    }, 90);
    return;
  }

  if (mode === "progress-forever") {
    setInterval(() => {
      writeFileSync(1, '{"text":"持续分析中"}\n');
    }, 15);
    return;
  }

  if (mode === "invalid-jsonl") {
    writeFileSync(1, "broken\n");
  }

  writeFileSync(1, '{"text":"开始调研"}\n');
  setTimeout(() => {
    writeFileSync(1, '{"item":{"text":"完成调研"}}\n');
    writeFileSync(join(process.cwd(), "report.md"), "# 调研报告\n\n完成", "utf8");
    process.exitCode = 0;
  }, 10);
}
