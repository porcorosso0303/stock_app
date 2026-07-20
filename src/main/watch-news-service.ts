import type {
  WatchNewsAnalysisResult,
  WatchNewsDebugRun,
  WatchNewsMessage,
  WatchTreeConfig
} from "../shared/types";
import {
  collectHoldingStocks,
  type WatchHoldingStock
} from "../shared/watch-tree";
import type { WatchNewsAnalysisProvider } from "./watch-news-analysis-provider";
import type { WatchNewsDraft, WatchNewsStore } from "./watch-news-store";

interface WatchNewsStoreLike {
  list(secids?: string[]): Promise<WatchNewsMessage[]>;
  addMessages(messages: WatchNewsDraft[], fetchedAt: string): Promise<WatchNewsMessage[]>;
  markRead(secid: string, messageIds: string[] | undefined, readAt: string): Promise<WatchNewsMessage[]>;
}

export class WatchNewsService {
  private latestProvider?: WatchNewsAnalysisProvider;

  constructor(
    private readonly store: WatchNewsStoreLike,
    private readonly resolveProvider: () => Promise<WatchNewsAnalysisProvider>,
    private readonly now: () => Date = () => new Date(),
    private readonly onMessagesChanged: () => void = () => undefined
  ) {}

  async list(secids?: string[]): Promise<WatchNewsMessage[]> {
    return await this.store.list(secids);
  }

  async markRead(secid: string, messageIds?: string[]): Promise<WatchNewsMessage[]> {
    return await this.store.markRead(secid, messageIds, this.now().toISOString());
  }

  async getLatestDebugRun(secid?: string): Promise<WatchNewsDebugRun | undefined> {
    const provider = this.latestProvider ?? await this.resolveProvider();
    this.latestProvider = provider;
    return await provider.getLatestDebugRun?.(secid);
  }

  async analyzeStock(stock: { secid: string; stockName: string }): Promise<WatchNewsAnalysisResult> {
    return await this.analyzeStocks([{
      secid: stock.secid,
      stockName: stock.stockName,
      nodeId: "",
      workspaceId: "",
      workspaceName: ""
    }]);
  }

  async analyzeHoldingStocks(config: WatchTreeConfig): Promise<WatchNewsAnalysisResult> {
    return await this.analyzeStocks(collectHoldingStocks(config));
  }

  private async analyzeStocks(stocks: WatchHoldingStock[]): Promise<WatchNewsAnalysisResult> {
    const uniqueStocks = uniqueBySecid(stocks);
    const provider = await this.resolveProvider();
    this.latestProvider = provider;
    const results = await mapWithConcurrency(uniqueStocks, 3, async (stock) => {
      const messages: WatchNewsMessage[] = [];
      try {
        const existingMessages = await this.store.list([stock.secid]);
        const drafts = await provider.analyze({
          secid: stock.secid,
          stockName: stock.stockName,
          existingMessages: existingMessages.map((message) => ({
            title: message.title,
            sourceUrl: message.sourceUrl,
            fetchedAt: message.fetchedAt
          }))
        }, async (partialDrafts) => {
          const inserted = await this.store.addMessages(
            partialDrafts,
            this.now().toISOString()
          );
          messages.push(...inserted);
          if (inserted.length > 0) {
            this.onMessagesChanged();
          }
        });
        const inserted = await this.store.addMessages(drafts, this.now().toISOString());
        messages.push(...inserted);
        if (drafts.length > 0) {
          this.onMessagesChanged();
        }
        return { stock, messages };
      } catch (error) {
        return {
          stock,
          errorMessage: error instanceof Error ? error.message : String(error),
          messages
        };
      }
    });
    const messages = uniqueMessages(results.flatMap((result) => result.messages));
    const errors = results.flatMap((result) => result.errorMessage
      ? [{
          secid: result.stock.secid,
          stockName: result.stock.stockName,
          errorMessage: result.errorMessage
        }]
      : []);
    return {
      stockCount: uniqueStocks.length,
      newMessageCount: messages.length,
      messages,
      errors
    };
  }
}

function uniqueMessages(messages: WatchNewsMessage[]): WatchNewsMessage[] {
  return [...new Map(messages.map((message) => [message.id, message])).values()];
}

function uniqueBySecid(stocks: WatchHoldingStock[]): WatchHoldingStock[] {
  const bySecid = new Map<string, WatchHoldingStock>();
  for (const stock of stocks) {
    if (!bySecid.has(stock.secid)) {
      bySecid.set(stock.secid, stock);
    }
  }
  return [...bySecid.values()];
}

async function mapWithConcurrency<T, U>(
  values: T[],
  concurrency: number,
  map: (value: T) => Promise<U>
): Promise<U[]> {
  const results = new Array<U>(values.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), values.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await map(values[index]);
    }
  }));
  return results;
}
