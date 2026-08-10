import type {
  StockQuote,
  StockSearchResult,
  StockTrend,
  WatchMarketRequestOptions,
  WatchMarketProviderId
} from "../../../../shared/types";
import type { MarketDataProvider } from "./market-data-provider";

interface ResettableProvider extends MarketDataProvider {
  reset?(): void;
}

export class SelectableMarketDataProvider implements MarketDataProvider {
  private readonly providers: Map<WatchMarketProviderId, ResettableProvider>;
  private currentProvider: ResettableProvider;

  constructor(
    providers: ResettableProvider[],
    initialProviderId: WatchMarketProviderId = "east-money"
  ) {
    this.providers = new Map(providers.map((provider) => [provider.id, provider]));
    const initial = this.providers.get(initialProviderId) ?? this.providers.get("east-money");
    if (!initial) {
      throw new Error("至少需要配置一个行情数据源");
    }
    this.currentProvider = initial;
  }

  get id(): WatchMarketProviderId {
    return this.currentProvider.id;
  }

  get label(): string {
    return this.currentProvider.label;
  }

  get cacheBehavior(): MarketDataProvider["cacheBehavior"] {
    return this.currentProvider.cacheBehavior;
  }

  select(providerId: WatchMarketProviderId): void {
    const next = this.providers.get(providerId);
    if (!next) {
      throw new Error(`未知行情数据源：${providerId}`);
    }
    this.currentProvider = next;
    next.reset?.();
  }

  listQuotes(secids: string[]): Promise<StockQuote[]> {
    return this.currentProvider.listQuotes(secids);
  }

  listTrends(secids: string[], options?: WatchMarketRequestOptions): Promise<StockTrend[]> {
    return options
      ? this.currentProvider.listTrends(secids, options)
      : this.currentProvider.listTrends(secids);
  }

  searchStocks(query: string): Promise<StockSearchResult[]> {
    return this.currentProvider.searchStocks(query);
  }
}
