/*
 * Is the address a model lives at somewhere on this machine, or somewhere else?
 *
 * The question matters exactly once: when the user has attached excerpts from
 * their private library and is about to send them somewhere. If that somewhere
 * is another container on the same host, saying so every time would be noise;
 * if it is a company on the internet, saying nothing would be a betrayal. So
 * this answers narrowly and pessimistically — "local" only for an address this
 * code can actually recognise as being here.
 *
 * What counts as here: loopback, Docker's host gateway, an RFC1918 or unique
 * local IP literal, and a bare service name with no dots at all, which on a
 * container network is a sibling container and nothing else. Everything with a
 * dot in it is remote, including names ending .local, .internal or .test — a
 * suffix is a naming convention, not a route, and `api.example-cloud.test`
 * resolves to whatever its DNS says. Getting this wrong in the cautious
 * direction shows one more honest sentence; getting it wrong in the other
 * direction sends private text away in silence.
 *
 * Pure and browser-safe: the composer calls it on every keystroke's worth of
 * state, and the unit tests call it with plain strings.
 */

/** The bare hostname of a `host` or `host:port` destination, lower-cased, brackets removed. */
function hostnameOf(destination: string): string {
  let text = destination.trim().toLowerCase();
  if (!text) return '';
  if (text.startsWith('[')) {
    // [::1]:8790 — a bracketed IPv6 literal, with or without a port.
    const close = text.indexOf(']');
    return close < 0 ? text.slice(1) : text.slice(1, close);
  }
  const colon = text.indexOf(':');
  // More than one colon and no brackets means a bare IPv6 literal, port and all
  // impossible to tell apart — so nothing is stripped.
  if (colon >= 0 && text.indexOf(':', colon + 1) < 0) text = text.slice(0, colon);
  return text;
}

/** Four numbers, each 0–255, and nothing else. Anything odd is simply not an IPv4 address. */
function ipv4(hostname: string): number[] | null {
  const parts = hostname.split('.');
  if (parts.length !== 4) return null;
  const bytes: number[] = [];
  for (const part of parts) {
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    bytes.push(value);
  }
  return bytes;
}

export function isLocalDestination(destination: string | null | undefined): boolean {
  const host = hostnameOf(destination || '');
  // No destination at all is nothing to disclose.
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host === 'host.docker.internal') return true;

  const v4 = ipv4(host);
  if (v4) {
    if (v4[0] === 127) return true;                                  // 127.0.0.0/8
    if (v4[0] === 10) return true;                                   // 10.0.0.0/8
    if (v4[0] === 172 && v4[1] >= 16 && v4[1] <= 31) return true;    // 172.16.0.0/12
    if (v4[0] === 192 && v4[1] === 168) return true;                 // 192.168.0.0/16
    return false;
  }

  if (host.includes(':')) {
    // An IPv6 literal. Only two shapes are "here": ::1, and the unique local
    // range fc00::/7 — a first hextet of fc00 through fdff.
    if (/^(0*:)*0*1$/.test(host) || host === '::1') return true;
    const head = host.startsWith('::') ? '0' : host.slice(0, host.indexOf(':'));
    if (!/^[0-9a-f]{1,4}$/.test(head)) return false;
    return (parseInt(head, 16) & 0xfe00) === 0xfc00;
  }

  // A name with no dot is a service on our own network — `mock`, `corpus`, `db`.
  // A name with one is somewhere on the internet until proven otherwise.
  return !host.includes('.');
}
