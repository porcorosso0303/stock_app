import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { createElectronNetFetch } from "../../src/main/modules/watch/market-data/east-money-provider";

class FakeRequest extends EventEmitter {
  abort = vi.fn();
  end = vi.fn();
}

class FakeResponse extends EventEmitter {
  constructor(readonly statusCode: number) {
    super();
  }
}

describe("EastMoney Electron network adapter", () => {
  it("maps an Electron net.request response to the provider fetch interface", async () => {
    const request = new FakeRequest();
    const response = new FakeResponse(200);
    const network = { request: vi.fn(() => request) };
    const fetchImpl = createElectronNetFetch(network);

    const resultPromise = fetchImpl("https://push2.eastmoney.com/test");
    request.emit("response", response);
    response.emit("data", Buffer.from('{"rc":0,"data":{"f43":1000}}'));
    response.emit("end");

    const result = await resultPromise;
    expect(network.request).toHaveBeenCalledWith("https://push2.eastmoney.com/test");
    expect(request.end).toHaveBeenCalledOnce();
    expect(result.ok).toBe(true);
    await expect(result.json()).resolves.toEqual({ rc: 0, data: { f43: 1000 } });
  });

  it("aborts the Electron ClientRequest and rejects immediately when signaled", async () => {
    const request = new FakeRequest();
    const network = { request: vi.fn(() => request) };
    const fetchImpl = createElectronNetFetch(network);
    const controller = new AbortController();

    const resultPromise = fetchImpl("https://push2his.eastmoney.com/test", {
      signal: controller.signal
    });
    controller.abort();

    await expect(resultPromise).rejects.toThrow("aborted");
    expect(request.abort).toHaveBeenCalledOnce();
  });
});
