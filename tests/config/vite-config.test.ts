import { describe, expect, it } from "vitest";
import config from "../../vite.config";

describe("Vite renderer config", () => {
  it("uses relative asset paths for Electron file URLs", () => {
    expect(config.base).toBe("./");
  });
});
