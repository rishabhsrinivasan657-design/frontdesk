import { BlockList, isIPv6 } from "node:net";

/** Private and carrier-grade NAT ranges: where a platform's own proxy lives, never a visitor. */
const PRIVATE = new BlockList();
PRIVATE.addSubnet("10.0.0.0", 8);
PRIVATE.addSubnet("172.16.0.0", 12);
PRIVATE.addSubnet("192.168.0.0", 16);
PRIVATE.addSubnet("100.64.0.0", 10);
PRIVATE.addSubnet("127.0.0.0", 8);
PRIVATE.addSubnet("fc00::", 7, "ipv6");
PRIVATE.addAddress("::1", "ipv6");

export function isPrivateAddress(address: string): boolean {
  const v4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (v4) return PRIVATE.check(v4[1]!, "ipv4");
  return PRIVATE.check(address, isIPv6(address) ? "ipv6" : "ipv4");
}

type TrustFn = (address: string, hop: number) => boolean;

/**
 * Who may tell the api a visitor's address (X-Forwarded-For). Behind Caddy: a list of proxy
 * addresses (TRUST_PROXY). On Render the proxy's address isn't fixed, so TRUST_PRIVATE_PROXY=1
 * trusts exactly one hop, and only when that direct peer is on a private network (Render's
 * proxy). A visitor connecting from the internet is never trusted, so it can't fake an address.
 * Without this every visitor looks like Render's proxy and they all share one set of limits.
 */
export function trustProxySetting(env: Record<string, string | undefined>): string[] | TrustFn {
  const flag = env.TRUST_PRIVATE_PROXY?.trim();
  if (flag) {
    if (flag !== "1") throw new Error("TRUST_PRIVATE_PROXY must be 1 or unset");
    return (address, hop) => hop === 0 && isPrivateAddress(address);
  }
  return (env.TRUST_PROXY ?? "127.0.0.1,::1")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
}
