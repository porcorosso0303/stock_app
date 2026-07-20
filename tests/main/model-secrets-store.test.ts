import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ModelSecretsStore,
  type SecretCryptography
} from "../../src/main/model-secrets-store";

const directories: string[] = [];

async function createStore(cryptography: SecretCryptography = createCryptography()): Promise<{
  path: string;
  store: ModelSecretsStore;
}> {
  const directory = await mkdtemp(join(tmpdir(), "stock-tool-model-secrets-"));
  directories.push(directory);
  const path = join(directory, "model-secrets.json");
  return { path, store: new ModelSecretsStore(path, cryptography) };
}

function createCryptography(available = true): SecretCryptography {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (value) => Buffer.from(`encrypted:${value}`, "utf8"),
    decryptString: (value) => value.toString("utf8").replace(/^encrypted:/, "")
  };
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true
  })));
});

describe("ModelSecretsStore", () => {
  it("reports both keys as unconfigured before the file exists", async () => {
    const { store } = await createStore();

    await expect(store.getStatus()).resolves.toEqual({
      hasDeepSeekApiKey: false,
      hasTavilyApiKey: false
    });
  });

  it("encrypts API keys before writing them", async () => {
    const { path, store } = await createStore();

    await store.update({
      deepSeekApiKey: "deepseek-secret-value",
      tavilyApiKey: "tavily-secret-value"
    });

    const rawFile = await readFile(path, "utf8");
    expect(rawFile).not.toContain("deepseek-secret-value");
    expect(rawFile).not.toContain("tavily-secret-value");
    await expect(store.getSecrets()).resolves.toEqual({
      deepSeekApiKey: "deepseek-secret-value",
      tavilyApiKey: "tavily-secret-value"
    });
    await expect(store.getStatus()).resolves.toEqual({
      hasDeepSeekApiKey: true,
      hasTavilyApiKey: true
    });
  });

  it("updates one key without replacing the other", async () => {
    const { store } = await createStore();
    await store.update({ deepSeekApiKey: "first", tavilyApiKey: "search" });

    await store.update({ deepSeekApiKey: "second" });

    await expect(store.getSecrets()).resolves.toEqual({
      deepSeekApiKey: "second",
      tavilyApiKey: "search"
    });
  });

  it("clears keys independently", async () => {
    const { store } = await createStore();
    await store.update({ deepSeekApiKey: "model", tavilyApiKey: "search" });

    await store.update({ clearDeepSeekApiKey: true });

    await expect(store.getSecrets()).resolves.toEqual({ tavilyApiKey: "search" });
    await expect(store.getStatus()).resolves.toEqual({
      hasDeepSeekApiKey: false,
      hasTavilyApiKey: true
    });
  });

  it("rejects key storage when OS encryption is unavailable", async () => {
    const { store } = await createStore(createCryptography(false));

    await expect(store.update({ deepSeekApiKey: "plain-text" }))
      .rejects.toThrow("系统安全存储不可用");
  });
});
