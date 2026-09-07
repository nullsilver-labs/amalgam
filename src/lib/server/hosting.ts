/*
 * Where this instance thinks it lives, and whose word it takes for it.
 *
 * Two ideas that are easy to confuse are kept apart here. ORIGIN is only an
 * address: the exact scheme, host and port a browser will type. Whether that
 * address is *acceptable* is a separate, explicit decision — plain HTTP off
 * loopback travels in the clear and is never a browser secure context, so the
 * operator has to say AMALGAM_PRIVATE_HTTP=true before the app will serve it.
 * Safety is never inferred from a private-looking IP: 10.0.0.1 over http is
 * exactly as unencrypted as a public address, and a VPN encrypting the wire
 * still does not make the page a secure context.
 *
 * The second decision is whose forwarded headers to believe. Anyone can send
 * X-Forwarded-Host; only the socket peer cannot be faked. So the peer address
 * (SvelteKit's event.getClientAddress(), which for adapter-node is the real
 * TCP peer as long as ADDRESS_HEADER is left unset) is matched against the
 * CIDRs in AMALGAM_TRUSTED_PROXIES, and the headers count only from those.
 *
 * Everything here is pure: given an env object and a set of headers it decides,
 * touching nothing. hooks.server.ts is the only caller.
 */

/** One parsed IP or CIDR: the network bytes and how many leading bits matter. */
export interface Cidr {
  /** 4 bytes for IPv4, 16 for IPv6. */
  bytes: Uint8Array;
  bits: number;
  /** The text it was written as, for messages. */
  source: string;
}

export interface HostingPolicy {
  origin: URL;
  privateHttp: boolean;
  trustedProxies: Cidr[];
  /** Non-null when the configuration must not be served; the message names the variable to set. */
  problem: string | null;
}

const DEFAULT_ORIGIN = 'http://localhost:8790';

/**
 * Parse a textual address into its bytes. Accepts IPv4, IPv6 (compressed or
 * not, with an optional %zone or [brackets]), and the IPv4-mapped form
 * ::ffff:1.2.3.4, which is normalised to four bytes so a v4 CIDR matches a
 * dual-stack socket's peer address.
 */
export function parseAddress(input: string): Uint8Array | null {
  let text = input.trim();
  if (text.startsWith('[') && text.endsWith(']')) text = text.slice(1, -1);
  const zone = text.indexOf('%');
  if (zone >= 0) text = text.slice(0, zone);
  if (!text) return null;
  if (!text.includes(':')) return parseIPv4(text);
  const bytes = parseIPv6(text);
  if (!bytes) return null;
  // ::ffff:a.b.c.d — the same host, reached over a dual-stack socket.
  const mapped = bytes.subarray(0, 12);
  if (mapped.every((b, i) => (i < 10 ? b === 0 : b === 0xff))) return bytes.subarray(12);
  return bytes;
}

function parseIPv4(text: string): Uint8Array | null {
  const parts = text.split('.');
  if (parts.length !== 4) return null;
  const bytes = new Uint8Array(4);
  for (let i = 0; i < 4; i++) {
    // No leading zeros: "010" is ambiguous enough that refusing it is kinder than guessing.
    if (!/^(0|[1-9]\d{0,2})$/.test(parts[i])) return null;
    const value = Number(parts[i]);
    if (value > 255) return null;
    bytes[i] = value;
  }
  return bytes;
}

function parseIPv6(text: string): Uint8Array | null {
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 ? (halves[1] ? halves[1].split(':') : []) : null;
  const groups: number[] = [];
  const push = (list: string[], last: boolean) => {
    for (let i = 0; i < list.length; i++) {
      const piece = list[i];
      // A trailing dotted quad stands for the final two groups.
      if (i === list.length - 1 && last && piece.includes('.')) {
        const quad = parseIPv4(piece);
        if (!quad) return false;
        groups.push((quad[0] << 8) | quad[1], (quad[2] << 8) | quad[3]);
        return true;
      }
      if (!/^[0-9a-fA-F]{1,4}$/.test(piece)) return false;
      groups.push(parseInt(piece, 16));
    }
    return true;
  };
  if (!push(head, tail === null)) return null;
  const before = groups.length;
  if (tail !== null) {
    if (!push(tail, true)) return null;
    const missing = 8 - groups.length;
    if (missing < 1) return null;
    groups.splice(before, 0, ...new Array<number>(missing).fill(0));
  }
  if (groups.length !== 8) return null;
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 8; i++) { bytes[i * 2] = groups[i] >> 8; bytes[i * 2 + 1] = groups[i] & 0xff; }
  return bytes;
}

/** "10.0.0.0/8, fd00::/8, 127.0.0.1" → the entries that parse. Unparseable entries are dropped. */
export function parseCidrs(value: string | undefined | null): Cidr[] {
  const result: Cidr[] = [];
  for (const raw of (value || '').split(',').map(s => s.trim()).filter(Boolean)) {
    const slash = raw.lastIndexOf('/');
    const address = slash < 0 ? raw : raw.slice(0, slash);
    const bytes = parseAddress(address);
    if (!bytes) continue;
    const full = bytes.length * 8;
    let bits = full;
    if (slash >= 0) {
      const suffix = raw.slice(slash + 1);
      if (!/^\d{1,3}$/.test(suffix)) continue;
      bits = Number(suffix);
      // A v4 prefix written against an IPv4-mapped address keeps its own scale.
      if (bits > full) continue;
    }
    result.push({ bytes, bits, source: raw });
  }
  return result;
}

/** Whether a socket peer address falls inside any of the configured networks. */
export function peerIsTrusted(peer: string | undefined | null, cidrs: Cidr[]): boolean {
  if (!peer || !cidrs.length) return false;
  const bytes = parseAddress(peer);
  if (!bytes) return false;
  return cidrs.some(cidr => matches(bytes, cidr));
}

function matches(address: Uint8Array, cidr: Cidr): boolean {
  if (address.length !== cidr.bytes.length) return false;
  const whole = cidr.bits >> 3;
  for (let i = 0; i < whole; i++) if (address[i] !== cidr.bytes[i]) return false;
  const rest = cidr.bits & 7;
  if (!rest) return true;
  const mask = 0xff << (8 - rest);
  return (address[whole] & mask) === (cidr.bytes[whole] & mask);
}

/**
 * The host and scheme this request claims to have been made to. A trusted peer
 * may speak for the browser through X-Forwarded-Host / -Proto (first value of
 * each, as proxies chain them); anyone else is simply not listened to — that is
 * not an error, it is the ordinary case of a direct request.
 */
export function claimedHost(headers: Headers, peerTrusted: boolean): { host: string; proto: string | null } {
  const direct = headers.get('host') || '';
  if (!peerTrusted) return { host: direct, proto: null };
  const forwardedHost = first(headers.get('x-forwarded-host'));
  const forwardedProto = first(headers.get('x-forwarded-proto'));
  return { host: forwardedHost || direct, proto: forwardedProto };
}

function first(value: string | null): string {
  return (value || '').split(',')[0].trim();
}

/** Loopback by address, not by name: 127.0.0.0/8, ::1, and the literal "localhost". */
export function isLoopbackHost(hostname: string): boolean {
  if (hostname === 'localhost') return true;
  const bytes = parseAddress(hostname);
  if (!bytes) return false;
  if (bytes.length === 4) return bytes[0] === 127;
  return bytes.every((b, i) => (i === 15 ? b === 1 : b === 0));
}

/** Read the hosting configuration once. The result is a decision, not a suggestion. */
export function hostingPolicy(env: Record<string, string | undefined>): HostingPolicy {
  const privateHttp = /^(true|1|yes)$/i.test((env.AMALGAM_PRIVATE_HTTP || '').trim());
  const trustedProxies = parseCidrs(env.AMALGAM_TRUSTED_PROXIES);
  let origin: URL;
  try {
    origin = new URL(env.ORIGIN || DEFAULT_ORIGIN);
  } catch {
    return {
      origin: new URL(DEFAULT_ORIGIN), privateHttp, trustedProxies,
      problem: `ORIGIN is not a valid absolute URL. Set it to the exact address a browser will use, such as ${DEFAULT_ORIGIN}.`
    };
  }
  if (origin.protocol !== 'http:' && origin.protocol !== 'https:') {
    return { origin, privateHttp, trustedProxies, problem: 'ORIGIN must be an http:// or https:// address.' };
  }
  if (origin.protocol === 'http:' && !isLoopbackHost(origin.hostname) && !privateHttp) {
    return {
      origin, privateHttp, trustedProxies,
      problem: `ORIGIN is ${origin.origin}, which serves this instance over plain HTTP beyond loopback. `
        + 'Put a TLS proxy in front of it, or set AMALGAM_PRIVATE_HTTP=true to accept an unencrypted private network, then restart amalgam.'
    };
  }
  return { origin, privateHttp, trustedProxies, problem: null };
}

/** The one line logged at startup when the operator has opted into unencrypted private hosting. */
export function privateHttpWarning(origin: URL): string {
  return `WARNING: AMALGAM_PRIVATE_HTTP is set, so amalgam is served at ${origin.origin} over plain HTTP. `
    + 'Passwords and conversations travel unencrypted unless the network tunnel encrypts them, '
    + 'and browsers will not treat the page as a secure context (no clipboard API, no microphone).';
}
