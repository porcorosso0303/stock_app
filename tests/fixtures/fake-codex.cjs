#!/usr/bin/env node
const { writeFileSync } = require("node:fs");
const { join } = require("node:path");

let prompt = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  prompt += chunk;
});
process.stdin.on("end", () => {
  writeFileSync(join(process.cwd(), "prompt.txt"), prompt, "utf8");
  const mode = process.env.FAKE_CODEX_MODE ?? "success";

  if (mode === "failure") {
    process.stderr.write("network error\n");
    process.exit(1);
  }

  if (mode === "slow") {
    process.stdout.write('{"text":"等待取消"}\n');
    setInterval(() => {}, 1000);
    return;
  }

  if (mode === "invalid-jsonl") {
    process.stdout.write("broken\n");
  }

  process.stdout.write('{"text":"开始调研"}\n');
  setTimeout(() => {
    process.stdout.write('{"item":{"text":"完成调研"}}\n');
    writeFileSync(join(process.cwd(), "report.md"), "# 调研报告\n\n完成", "utf8");
    process.exit(0);
  }, 10);
});
