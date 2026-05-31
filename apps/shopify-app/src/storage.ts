import crypto from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export interface ShopifyInstallation {
  shop: string;
  tenantId: string;
  accessToken: string;
  scope: string;
  installedAt: string;
  updatedAt: string;
  webhookTopics: string[];
}

interface StoredInstallation extends Omit<ShopifyInstallation, "accessToken"> {
  accessToken: string;
}

interface InstallationFile {
  installations?: StoredInstallation[];
}

function encryptionKey(secret: string) {
  return secret ? crypto.createHash("sha256").update(secret).digest() : null;
}

function encrypt(value: string, secret: string) {
  const key = encryptionKey(secret);
  if (!key || value.startsWith("enc:v1:")) return value;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${ciphertext.toString("base64url")}`;
}

function decrypt(value: string, secret: string) {
  if (!value.startsWith("enc:v1:")) return value;
  const key = encryptionKey(secret);
  if (!key) return "";
  const [, version, iv, tag, ciphertext] = value.split(":");
  if (version !== "v1" || !iv || !tag || !ciphertext) return "";
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64url")),
      decipher.final()
    ]).toString("utf8");
  } catch {
    return "";
  }
}

export class ShopifyInstallationStore {
  private readonly filePath: string;
  private readonly secret: string;

  constructor(filePath: string, secret: string) {
    this.filePath = resolve(filePath);
    this.secret = secret;
  }

  async list() {
    return this.read();
  }

  async upsert(installation: ShopifyInstallation) {
    const installations = await this.read();
    const nextInstallation = {
      ...installation,
      updatedAt: new Date().toISOString()
    };
    const index = installations.findIndex((item) => item.shop === installation.shop);
    if (index >= 0) {
      installations[index] = nextInstallation;
    } else {
      installations.unshift(nextInstallation);
    }
    await this.write(installations);
    return nextInstallation;
  }

  async delete(shop: string) {
    const installations = await this.read();
    const remaining = installations.filter((item) => item.shop !== shop);
    if (remaining.length === installations.length) return false;
    await this.write(remaining);
    return true;
  }

  private async read(): Promise<ShopifyInstallation[]> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as InstallationFile;
      return Array.isArray(parsed.installations)
        ? parsed.installations.map((item) => ({
            ...item,
            accessToken: decrypt(item.accessToken, this.secret)
          }))
        : [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  private async write(installations: ShopifyInstallation[]) {
    await mkdir(dirname(this.filePath), { recursive: true });
    const payload: InstallationFile = {
      installations: installations.map((item) => ({
        ...item,
        accessToken: encrypt(item.accessToken, this.secret)
      }))
    };
    const tempPath = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(tempPath, JSON.stringify(payload, null, 2), "utf8");
    await rename(tempPath, this.filePath);
  }
}
