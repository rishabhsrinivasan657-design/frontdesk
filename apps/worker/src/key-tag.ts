import { createHmac } from "node:crypto";

export type KeyTag = (value: string) => string;

/**
 * A short keyed one-way tag, so Redis keys never hold an IP, contact or session id (M10
 * privacy). Keyed with a server secret: a plain hash of an IPv4 address or a phone number can
 * be reversed by hashing every possible value.
 */
export function createKeyTag(secret: string): KeyTag {
  return (value) => createHmac("sha256", secret).update(value).digest("hex").slice(0, 16);
}

/** From KEY_HASH_SECRET; the production guard requires a real one, so "dev" is local only. */
export function readKeyTag(env: Record<string, string | undefined>): KeyTag {
  return createKeyTag(env.KEY_HASH_SECRET?.trim() || "dev");
}
