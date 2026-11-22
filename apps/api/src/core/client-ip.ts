import { isIPv4, isIPv6 } from 'node:net';

/** Expands an IPv6 address to its 8 hextets (handles `::` and embedded IPv4). */
function expandIPv6(address: string): string[] | null {
  const withoutZone = address.split('%')[0] ?? '';
  let text = withoutZone;

  // Embedded IPv4 tail (e.g. 64:ff9b::1.2.3.4) → two hextets.
  const lastColon = text.lastIndexOf(':');
  const tail = text.slice(lastColon + 1);
  if (isIPv4(tail)) {
    const [a = 0, b = 0, c = 0, d = 0] = tail.split('.').map(Number);
    text = `${text.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }

  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return null;

  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...rest];
  return groups.map((group) => group.toLowerCase().padStart(4, '0'));
}

/**
 * Key for per-client rate limiting and brute-force throttling.
 *
 * - IPv4 (and IPv4-mapped IPv6 like `::ffff:1.2.3.4`) → the IPv4 address.
 * - IPv6 → its /64 prefix. A single subscriber is normally given a whole /64
 *   (2^64 addresses); keying on the full address would let an attacker rotate
 *   addresses and never hit a per-IP limit.
 */
export function clientRateKey(ip: string | undefined): string {
  if (!ip) return 'unknown';
  const trimmed = ip.trim();

  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(trimmed);
  if (mapped?.[1] && isIPv4(mapped[1])) return mapped[1];
  if (isIPv4(trimmed)) return trimmed;

  if (isIPv6(trimmed)) {
    const groups = expandIPv6(trimmed);
    if (groups) return `${groups.slice(0, 4).join(':')}::/64`;
  }
  return trimmed;
}
