import { BlockList, isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

/**
 * Outgoing calls go to addresses an admin typed. Without a check, a "webhook" could point at
 * `http://169.254.169.254/` (a cloud's secret service) or at our own database: SSRF. So only
 * https, and never a private, loopback or link-local address.
 */

const PRIVATE = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local, cloud metadata
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 3], // multicast and reserved (224.0.0.0 - 255.255.255.255)
] as const) {
  PRIVATE.addSubnet(net, prefix, 'ipv4');
}
for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['fec0::', 10], // old site-local
  ['ff00::', 8], // multicast
  ['100::', 64], // discard-only
] as const) {
  PRIVATE.addSubnet(net, prefix, 'ipv6');
}

/** An IPv6 address as 16 bytes, or null when it is not one. Handles "::" and a dotted IPv4 tail. */
function ipv6Bytes(address: string): number[] | null {
  let text =
    address
      .toLowerCase()
      .replace(/^\[|\]$/g, '')
      .split('%')[0] ?? '';
  const tail = text.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (tail) {
    const [a, b, c, d] = tail.slice(1).map(Number) as [number, number, number, number];
    text =
      text.slice(0, tail.index) + `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...rest];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.flatMap((g) => [parseInt(g, 16) >> 8, parseInt(g, 16) & 255]);
}

/** The IPv4 address hidden inside an IPv6 one (mapped, compatible, NAT64, 6to4), if any. */
function embeddedIpv4(bytes: number[]): string | null {
  const zeros = (from: number, to: number) => bytes.slice(from, to).every((b) => b === 0);
  const v4 = (at: number) => bytes.slice(at, at + 4).join('.');
  if (zeros(0, 10) && bytes[10] === 0xff && bytes[11] === 0xff) return v4(12); // ::ffff:a.b.c.d
  if (zeros(0, 12)) return v4(12); // ::a.b.c.d (compatible)
  if (
    bytes[0] === 0x00 &&
    bytes[1] === 0x64 &&
    bytes[2] === 0xff &&
    bytes[3] === 0x9b &&
    zeros(4, 12)
  ) {
    return v4(12); // 64:ff9b::/96 (NAT64)
  }
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return v4(2); // 2002::/16 (6to4)
  return null;
}

/** True for an address that is not on the public internet (IPv4 and IPv6, in every spelling). */
export function isPrivateAddress(address: string): boolean {
  const clean = address.replace(/^\[|\]$/g, '');
  if (isIP(clean) === 4) return PRIVATE.check(clean, 'ipv4');
  const bytes = ipv6Bytes(clean);
  if (!bytes) return true; // not an address we understand: do not call it
  const inner = embeddedIpv4(bytes);
  if (inner !== null && PRIVATE.check(inner, 'ipv4')) return true;
  return PRIVATE.check(
    bytes
      .reduce<string[]>((groups, byte, i) => {
        if (i % 2 === 0) groups.push(byte.toString(16).padStart(2, '0'));
        else groups[groups.length - 1] += byte.toString(16).padStart(2, '0');
        return groups;
      }, [])
      .join(':'),
    'ipv6',
  );
}

/** The name alone is enough to refuse: no DNS needed (also used when an integration is saved). */
export function isInternalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (isIP(host) || host.includes(':')) return isPrivateAddress(host);
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    !host.includes('.')
  );
}

export class UrlNotAllowedError extends Error {
  constructor() {
    super('url_not_allowed');
    this.name = 'UrlNotAllowedError';
  }
}

/** Parses and checks an address without the network: https only, and not an internal name. */
export function checkWebhookUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UrlNotAllowedError();
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    isInternalHostname(url.hostname)
  ) {
    throw new UrlNotAllowedError();
  }
  return url;
}

/** Right before sending: the name must also resolve only to public addresses. */
export async function assertPublicUrl(raw: string): Promise<URL> {
  const url = checkWebhookUrl(raw);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!isIP(host)) {
    const addresses = await lookup(host, { all: true }).catch(() => []);
    if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address))) {
      throw new UrlNotAllowedError();
    }
  }
  return url;
}
