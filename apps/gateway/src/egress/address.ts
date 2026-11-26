import { isIP } from "node:net";

export type BlockedReason =
  | "invalid"
  | "loopback"
  | "private"
  | "link-local"
  | "cgnat"
  | "unspecified"
  | "multicast"
  | "reserved"
  | "cloud-metadata";

export type AddressVerdict = { allowed: true } | { allowed: false; reason: BlockedReason };

type Range = { prefix: bigint; bits: number; width: 32 | 128; reason: BlockedReason };

function v4(prefix: string, bits: number, reason: BlockedReason): Range {
  return { prefix: BigInt(ipv4ToInt(prefix)!), bits, width: 32, reason };
}

function v6(prefix: string, bits: number, reason: BlockedReason): Range {
  return { prefix: ipv6ToBigInt(prefix)!, bits, width: 128, reason };
}

const blockedV4: Range[] = [
  v4("169.254.169.254", 32, "cloud-metadata"),
  v4("169.254.170.2", 32, "cloud-metadata"),
  v4("100.100.100.200", 32, "cloud-metadata"),
  v4("127.0.0.0", 8, "loopback"),
  v4("0.0.0.0", 8, "unspecified"),
  v4("10.0.0.0", 8, "private"),
  v4("172.16.0.0", 12, "private"),
  v4("192.168.0.0", 16, "private"),
  v4("169.254.0.0", 16, "link-local"),
  v4("100.64.0.0", 10, "cgnat"),
  v4("224.0.0.0", 4, "multicast"),
  v4("192.0.0.0", 24, "reserved"),
  v4("192.0.2.0", 24, "reserved"),
  v4("198.18.0.0", 15, "reserved"),
  v4("198.51.100.0", 24, "reserved"),
  v4("203.0.113.0", 24, "reserved"),
  v4("240.0.0.0", 4, "reserved"),
];

const blockedV6: Range[] = [
  v6("fd00:ec2::254", 128, "cloud-metadata"),
  v6("::1", 128, "loopback"),
  v6("::", 128, "unspecified"),
  v6("fc00::", 7, "private"),
  v6("fe80::", 10, "link-local"),
  v6("ff00::", 8, "multicast"),
  v6("2001:db8::", 32, "reserved"),
  v6("100::", 64, "reserved"),
  v6("2001::", 32, "reserved"),
  v6("2002::", 16, "reserved"),
];

const mappedV4Prefix = ipv6ToBigInt("::ffff:0:0")! >> 32n;
const nat64Prefix = ipv6ToBigInt("64:ff9b::")! >> 32n;

export function classifyAddress(value: string): AddressVerdict {
  const address = value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
  const family = isIP(address);
  if (family === 4) return classifyV4(ipv4ToInt(address)!);
  if (family === 6) return classifyV6(ipv6ToBigInt(address)!);
  return { allowed: false, reason: "invalid" };
}

function classifyV4(value: number): AddressVerdict {
  for (const range of blockedV4) {
    if (inRange(BigInt(value), range.prefix, range.bits, 32)) {
      return { allowed: false, reason: range.reason };
    }
  }
  return { allowed: true };
}

function classifyV6(value: bigint): AddressVerdict {
  for (const range of blockedV6) {
    if (inRange(value, range.prefix, range.bits, 128)) {
      return { allowed: false, reason: range.reason };
    }
  }
  const upper = value >> 32n;
  if (upper === mappedV4Prefix || upper === nat64Prefix) {
    const embedded = Number(value & 0xffffffffn);
    return classifyV4(embedded);
  }
  return { allowed: true };
}

function inRange(value: bigint, prefix: bigint, bits: number, width: 32 | 128): boolean {
  const shift = BigInt(width - bits);
  return value >> shift === prefix >> shift;
}

function ipv4ToInt(address: string): number | undefined {
  const parts = address.split(".");
  if (parts.length !== 4) return undefined;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return undefined;
    const octet = Number(part);
    if (octet > 255) return undefined;
    value = value * 256 + octet;
  }
  return value;
}

function ipv6ToBigInt(address: string): bigint | undefined {
  const zone = address.indexOf("%");
  const clean = zone === -1 ? address : address.slice(0, zone);
  const halves = clean.split("::");
  if (halves.length > 2) return undefined;

  const parseGroups = (part: string): number[] | undefined => {
    if (part === "") return [];
    const groups: number[] = [];
    for (const group of part.split(":")) {
      if (group.includes(".")) {
        const embedded = ipv4ToInt(group);
        if (embedded === undefined) return undefined;
        groups.push(Math.floor(embedded / 65536), embedded % 65536);
      } else {
        if (!/^[0-9a-f]{1,4}$/i.test(group)) return undefined;
        groups.push(parseInt(group, 16));
      }
    }
    return groups;
  };

  const head = parseGroups(halves[0] ?? "");
  const tail = halves.length === 2 ? parseGroups(halves[1] ?? "") : [];
  if (!head || !tail) return undefined;

  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return undefined;

  const groups = [...head, ...Array<number>(missing).fill(0), ...tail];
  let value = 0n;
  for (const group of groups) value = (value << 16n) | BigInt(group);
  return value;
}
