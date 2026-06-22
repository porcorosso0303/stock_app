import {
  EastMoneyQuoteService,
  type FetchLike,
  type FetchResponseLike
} from "../../../east-money-quote-service";
import type { MarketDataProvider } from "./market-data-provider";

interface ElectronIncomingMessageLike {
  readonly statusCode: number;
  on(event: "data", listener: (chunk: Buffer) => void): this;
  on(event: "end", listener: () => void): this;
  on(event: "error", listener: (error: Error) => void): this;
  on(event: "aborted", listener: () => void): this;
}

interface ElectronClientRequestLike {
  on(event: "response", listener: (response: ElectronIncomingMessageLike) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
  abort(): void;
  end(): unknown;
}

interface ElectronNetLike {
  request(url: string): ElectronClientRequestLike;
}

export class EastMoneyMarketDataProvider
  extends EastMoneyQuoteService
  implements MarketDataProvider {
  readonly id = "east-money";
  readonly label = "东方财富";
}

export function createElectronNetFetch(network: ElectronNetLike): FetchLike {
  return async (url, init) => await new Promise<FetchResponseLike>((resolve, reject) => {
    const request = network.request(url);
    let settled = false;
    const finish = (action: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      init?.signal?.removeEventListener("abort", handleAbort);
      action();
    };
    const fail = (error: Error): void => finish(() => reject(error));
    const handleAbort = (): void => {
      fail(new Error("aborted"));
      request.abort();
    };

    if (init?.signal?.aborted) {
      handleAbort();
      return;
    }
    init?.signal?.addEventListener("abort", handleAbort, { once: true });
    request.on("error", fail);
    request.on("response", (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("error", fail);
      response.on("aborted", () => fail(new Error("aborted")));
      response.on("end", () => finish(() => resolve({
        ok: response.statusCode >= 200 && response.statusCode < 300,
        json: async () => JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown
      })));
    });
    request.end();
  });
}
