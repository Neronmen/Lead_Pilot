import { BlockList, isIP } from 'node:net';

/**
 * SSRF guard (server-side request forgery). Enrichment fetches a website whose
 * address came from a stranger's form. Without a check, a lead with the website
 * "http://169.254.169.254/" (the cloud metadata service) or "localhost:5432"
 * would make OUR server read internal data for them. So a fetch only goes to
 * public internet addresses; everything below is refused.
 */
const blocked = new BlockList();
const v4 = (net: string, prefix: number) => blocked.addSubnet(net, prefix, 'ipv4');
const v6 = (net: string, prefix: number) => blocked.addSubnet(net, prefix, 'ipv6');

v4('0.0.0.0', 8); // "this network"
v4('10.0.0.0', 8); // private
v4('100.64.0.0', 10); // carrier-grade NAT
v4('127.0.0.0', 8); // loopback
v4('169.254.0.0', 16); // link-local, including the cloud metadata address
v4('172.16.0.0', 12); // private
v4('192.0.0.0', 24); // IETF protocol assignments
v4('192.0.2.0', 24); // documentation
v4('192.88.99.0', 24); // 6to4 relay
v4('192.168.0.0', 16); // private
v4('198.18.0.0', 15); // benchmarking
v4('198.51.100.0', 24); // documentation
v4('203.0.113.0', 24); // documentation
v4('224.0.0.0', 4); // multicast
v4('240.0.0.0', 4); // reserved, and the broadcast address

v6('::', 128); // unspecified
v6('::1', 128); // loopback
v6('64:ff9b::', 96); // NAT64: embeds an IPv4 address
v6('100::', 64); // discard
v6('2001::', 32); // Teredo: embeds an IPv4 address
v6('2001:db8::', 32); // documentation
v6('2002::', 16); // 6to4: embeds an IPv4 address
v6('fc00::', 7); // unique local (private)
v6('fe80::', 10); // link-local
v6('ff00::', 8); // multicast

/** "::ffff:127.0.0.1" is the IPv4 address 127.0.0.1 in disguise: look at the part inside. */
function unmap(address: string): string {
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
  if (mapped) return mapped[1]!;
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(address);
  if (hex) {
    const high = parseInt(hex[1]!, 16);
    const low = parseInt(hex[2]!, 16);
    return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
  }
  return address;
}

/** True only for an address on the public internet. Anything that is not an IP address is false. */
export function isPublicAddress(address: string): boolean {
  const ip = unmap(address.trim());
  const family = isIP(ip);
  if (family === 0) return false;
  return !blocked.check(ip, family === 4 ? 'ipv4' : 'ipv6');
}
