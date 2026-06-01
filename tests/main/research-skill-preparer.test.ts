import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { ResearchSkillPreparer } from "../../src/main/research-skill-preparer";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true
  })));
});

describe("ResearchSkillPreparer", () => {
  it("copies the embedded skill and injects the current user spec", async () => {
    const directory = await mkdtemp(join(tmpdir(), "stock-tool-skill-"));
    directories.push(directory);
    const embeddedSkill = join(directory, "embedded-skill");
    const runDirectory = join(directory, "run");
    await mkdir(join(embeddedSkill, "references"), { recursive: true });
    await writeFile(join(embeddedSkill, "SKILL.md"), "# Embedded skill", "utf8");
    await writeFile(
      join(embeddedSkill, "references", "stock_research_spec.md"),
      "embedded default",
      "utf8"
    );
    const preparer = new ResearchSkillPreparer(embeddedSkill, {
      get: async () => "user-maintained spec"
    });

    await preparer.prepare(runDirectory);

    const copiedSkill = join(
      runDirectory,
      ".agents",
      "skills",
      "research-a-share-stock"
    );
    await expect(readFile(join(copiedSkill, "SKILL.md"), "utf8"))
      .resolves.toBe("# Embedded skill");
    await expect(readFile(
      join(copiedSkill, "references", "stock_research_spec.md"),
      "utf8"
    )).resolves.toBe("user-maintained spec");
  });
});
