import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Encrypts secrets (calendar feed addresses, later provider keys) before they reach the database.
// AES-256-GCM. The key is ENCRYPTION_KEY: 32 random bytes written as 64 hex characters or base64.

export function loadKey(raw = process.env.ENCRYPTION_KEY): Buffer {
  if (!raw) throw new Error("ENCRYPTION_KEY is not set");
  const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("ENCRYPTION_KEY must be 32 bytes (64 hex characters)");
  return key;
}

export function encrypt(plain: string, key = loadKey()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), body.toString("base64")].join(".");
}

export function decrypt(token: string, key = loadKey()): string {
  const [v, iv, tag, body] = token.split(".");
  if (v !== "v1" || !iv || !tag || !body) throw new Error("Unreadable encrypted value");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64")), decipher.final()]).toString("utf8");
}
