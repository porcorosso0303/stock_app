import { EastMoneyQuoteService } from "../../../east-money-quote-service";
import type { MarketDataProvider } from "./market-data-provider";

export class EastMoneyMarketDataProvider
  extends EastMoneyQuoteService
  implements MarketDataProvider {
  readonly id = "east-money";
  readonly label = "东方财富";
}
