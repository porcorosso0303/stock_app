import { Buffer } from "node:buffer";
import { JsonStore } from "./json-store";

export interface SecretCryptography {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

export interface ModelSecrets {
  deepSeekApiKey?: string;
  tavilyApiKey?: string;
}

export interface ModelSecretsStatus {
  hasDeepSeekApiKey: boolean;
  hasTavilyApiKey: boolean;
}

export interface ModelSecretsUpdate extends ModelSecrets {
  clearDeepSeekApiKey?: boolean;
  clearTavilyApiKey?: boolean;
}

interface StoredModelSecrets {
  version: 1;
  deepSeekApiKey?: string;
  tavilyApiKey?: string;
}

export class ModelSecretsStore {
  private readonly store: JsonStore<StoredModelSecrets>;

  constructor(
    path: string,
    private readonly cryptography: SecretCryptography
  ) {
    this.store = new JsonStore(path, () => ({ version: 1 }));
  }

  async getStatus(): Promise<ModelSecretsStatus> {
    const stored = await this.store.read();
    return {
      hasDeepSeekApiKey: Boolean(stored.deepSeekApiKey),
      hasTavilyApiKey: Boolean(stored.tavilyApiKey)
    };
  }

  async getSecrets(): Promise<ModelSecrets> {
    const stored = await this.store.read();
    return {
      ...(stored.deepSeekApiKey
        ? { deepSeekApiKey: this.decrypt(stored.deepSeekApiKey) }
        : {}),
      ...(stored.tavilyApiKey
        ? { tavilyApiKey: this.decrypt(stored.tavilyApiKey) }
        : {})
    };
  }

  async update(update: ModelSecretsUpdate): Promise<void> {
    const hasNewSecret = Boolean(update.deepSeekApiKey?.trim() || update.tavilyApiKey?.trim());
    if (hasNewSecret && !this.cryptography.isEncryptionAvailable()) {
      throw new Error("系统安全存储不可用，无法安全保存模型 API Key");
    }

    const stored = await this.store.read();
    const next: StoredModelSecrets = { ...stored, version: 1 };
    if (update.clearDeepSeekApiKey) {
      delete next.deepSeekApiKey;
    }
    if (update.clearTavilyApiKey) {
      delete next.tavilyApiKey;
    }
    if (update.deepSeekApiKey?.trim()) {
      next.deepSeekApiKey = this.encrypt(update.deepSeekApiKey.trim());
    }
    if (update.tavilyApiKey?.trim()) {
      next.tavilyApiKey = this.encrypt(update.tavilyApiKey.trim());
    }
    await this.store.write(next);
  }

  private encrypt(value: string): string {
    return this.cryptography.encryptString(value).toString("base64");
  }

  private decrypt(value: string): string {
    return this.cryptography.decryptString(Buffer.from(value, "base64"));
  }
}
