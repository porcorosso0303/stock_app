import { cp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

interface ResearchSpecStoreLike {
  get(): Promise<string>;
}

export class ResearchSkillPreparer {
  constructor(
    private readonly embeddedSkillDirectory: string,
    private readonly researchSpecStore: ResearchSpecStoreLike
  ) {}

  async prepare(runDirectory: string): Promise<void> {
    const skillDirectory = join(
      runDirectory,
      ".agents",
      "skills",
      "research-a-share-stock"
    );
    await mkdir(skillDirectory, { recursive: true });
    await cp(this.embeddedSkillDirectory, skillDirectory, { recursive: true });
    await writeFile(
      join(skillDirectory, "references", "stock_research_spec.md"),
      await this.researchSpecStore.get(),
      "utf8"
    );
  }
}
