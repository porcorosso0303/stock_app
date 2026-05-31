import type { ResearchRecord } from "../shared/types";
import { JsonStore } from "./json-store";

export class HistoryStore {
  private readonly store: JsonStore<ResearchRecord[]>;

  constructor(path: string) {
    this.store = new JsonStore(path, () => []);
  }

  async list(): Promise<ResearchRecord[]> {
    const records = await this.store.read();
    return records.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async get(id: string): Promise<ResearchRecord | undefined> {
    return (await this.store.read()).find((record) => record.id === id);
  }

  async create(record: ResearchRecord): Promise<void> {
    const records = await this.store.read();
    if (records.some((existing) => existing.id === record.id)) {
      throw new Error(`历史记录已存在：${record.id}`);
    }
    records.push(record);
    await this.store.write(records);
  }

  async update(
    id: string,
    patch: Partial<ResearchRecord>
  ): Promise<ResearchRecord> {
    const records = await this.store.read();
    const index = records.findIndex((record) => record.id === id);
    if (index === -1) {
      throw new Error(`未找到历史记录：${id}`);
    }

    const record = {
      ...records[index],
      ...patch,
      id,
      updatedAt: patch.updatedAt ?? new Date().toISOString()
    };
    records[index] = record;
    await this.store.write(records);
    return record;
  }
}
