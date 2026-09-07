import { describe, it, expect } from 'vitest';
import { claimedHost, hostingPolicy, isLoopbackHost, parseAddress, parseCidrs, peerIsTrusted } from '../src/lib/server/hosting';
import { detectCapabilities, describeClipboard, type BrowserLike } from '../src/lib/capabilities';

const headers = (values: Record<string, string>) => new Headers(values);

describe('hosting policy', () => {
  it('serves loopback over plain HTTP without ceremony', () => {
    for (const origin of ['http://localhost:8790', 'http://127.0.0.1:8790', 'http://[::1]:8790']) {
      const policy = hostingPolicy({ ORIGIN: origin });
      expect(policy.problem).toBeNull();
      expect(policy.origin.origin).toBe(new URL(origin).origin);
    }
    expect(hostingPolicy({}).origin.host).toBe('localhost:8790');
  });
  it('refuses plain HTTP beyond loopback until the operator opts in, whatever the address looks like', () => {
    for (const origin of ['http://192.168.1.10:8790', 'http://10.0.0.5:8790', 'http://amalgam.example.com', 'http://[fd00::1]:8790']) {
      const refused = hostingPolicy({ ORIGIN: origin });
      expect(refused.problem).toContain('AMALGAM_PRIVATE_HTTP');
      expect(hostingPolicy({ ORIGIN: origin, AMALGAM_PRIVATE_HTTP: 'true' }).problem).toBeNull();
    }
  });
  it('never needs the opt-in for HTTPS, and reports an unusable ORIGIN plainly', () => {
    expect(hostingPolicy({ ORIGIN: 'https://amalgam.example.com' }).problem).toBeNull();
    expect(hostingPolicy({ ORIGIN: 'not a url' }).problem).toContain('ORIGIN');
    expect(hostingPolicy({ ORIGIN: 'ftp://example.com' }).problem).toContain('http://');
  });
  it('reads the opt-in as a word, not as any non-empty string', () => {
    expect(hostingPolicy({ ORIGIN: 'http://192.168.1.10:8790', AMALGAM_PRIVATE_HTTP: 'TRUE' }).problem).toBeNull();
    expect(hostingPolicy({ ORIGIN: 'http://192.168.1.10:8790', AMALGAM_PRIVATE_HTTP: 'false' }).problem).toContain('AMALGAM_PRIVATE_HTTP');
    expect(hostingPolicy({ ORIGIN: 'http://192.168.1.10:8790', AMALGAM_PRIVATE_HTTP: 'maybe' }).problem).toContain('AMALGAM_PRIVATE_HTTP');
  });
  it('treats loopback as an address range, not a name that looks friendly', () => {
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('127.13.9.2')).toBe(true);
    expect(isLoopbackHost('::1')).toBe(true);
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('localhost.evil.example')).toBe(false);
    expect(isLoopbackHost('192.168.1.10')).toBe(false);
    expect(isLoopbackHost('fd00::1')).toBe(false);
  });
});

describe('address and CIDR matching', () => {
  it('parses IPv4, IPv6 and the mapped form, and rejects nonsense', () => {
    expect(Array.from(parseAddress('192.168.1.10')!)).toEqual([192, 168, 1, 10]);
    expect(parseAddress('::1')).toHaveLength(16);
    expect(parseAddress('fd00:0:0:0:0:0:0:1')).toHaveLength(16);
    // A dual-stack socket reports v4 peers this way; a v4 rule must still match.
    expect(Array.from(parseAddress('::ffff:10.1.2.3')!)).toEqual([10, 1, 2, 3]);
    expect(Array.from(parseAddress('[fe80::1%eth0]')!.slice(0, 2))).toEqual([0xfe, 0x80]);
    for (const bad of ['', '1.2.3', '1.2.3.4.5', '256.1.1.1', '01.2.3.4', 'fd00::1::2', 'not-an-ip', 'fd00:::1']) {
      expect(parseAddress(bad)).toBeNull();
    }
  });
  it('matches a peer against v4 and v6 networks, including partial-byte prefixes', () => {
    const cidrs = parseCidrs('127.0.0.1, 10.89.79.10, 172.18.0.0/16, 192.168.4.0/22, fd00::/8, 2001:db8::/32');
    expect(cidrs.map(c => c.source)).toHaveLength(6);
    expect(peerIsTrusted('127.0.0.1', cidrs)).toBe(true);
    expect(peerIsTrusted('127.0.0.2', cidrs)).toBe(false);
    expect(peerIsTrusted('10.89.79.10', cidrs)).toBe(true);
    expect(peerIsTrusted('10.89.79.11', cidrs)).toBe(false);
    expect(peerIsTrusted('172.18.9.9', cidrs)).toBe(true);
    expect(peerIsTrusted('172.19.9.9', cidrs)).toBe(false);
    expect(peerIsTrusted('192.168.7.1', cidrs)).toBe(true);   // 4.0/22 spans .4 to .7
    expect(peerIsTrusted('192.168.8.1', cidrs)).toBe(false);
    expect(peerIsTrusted('fd12::9', cidrs)).toBe(true);
    expect(peerIsTrusted('fe80::9', cidrs)).toBe(false);
    expect(peerIsTrusted('2001:db8:1::5', cidrs)).toBe(true);
    expect(peerIsTrusted('2001:db9:1::5', cidrs)).toBe(false);
    // A v4 rule reaches a v4 peer arriving over a dual-stack socket.
    expect(peerIsTrusted('::ffff:172.18.0.9', cidrs)).toBe(true);
  });
  it('trusts nobody by default, and drops entries it cannot understand', () => {
    expect(peerIsTrusted('127.0.0.1', parseCidrs(undefined))).toBe(false);
    expect(peerIsTrusted('127.0.0.1', parseCidrs(''))).toBe(false);
    expect(parseCidrs('nonsense, 10.0.0.0/99, 10.0.0.0/x, 10.0.0.0/8').map(c => c.source)).toEqual(['10.0.0.0/8']);
    expect(peerIsTrusted(undefined, parseCidrs('0.0.0.0/0'))).toBe(false);
  });
});

describe('forwarded headers', () => {
  const forwarded = headers({ host: 'app:3000', 'x-forwarded-host': 'amalgam.example.com, inner', 'x-forwarded-proto': 'https,http' });
  it('takes the first forwarded value from a trusted peer', () => {
    expect(claimedHost(forwarded, true)).toEqual({ host: 'amalgam.example.com', proto: 'https' });
  });
  it('ignores the headers from anyone else, without calling it an error', () => {
    expect(claimedHost(forwarded, false)).toEqual({ host: 'app:3000', proto: null });
  });
  it('falls back to the real Host when a trusted proxy forwards nothing', () => {
    expect(claimedHost(headers({ host: 'localhost:8790' }), true)).toEqual({ host: 'localhost:8790', proto: '' });
  });
});

describe('browser capabilities', () => {
  const view = (over: BrowserLike): BrowserLike => ({ document: { execCommand: () => true }, navigator: {}, ...over });
  it('reports the modern clipboard only in a secure context', () => {
    const secure = view({ isSecureContext: true, navigator: { clipboard: { writeText: () => {} } } });
    expect(detectCapabilities(secure)).toEqual({ secureContext: true, clipboard: 'async', microphone: false });
    const insecure = view({ isSecureContext: false, navigator: { clipboard: { writeText: () => {} } } });
    expect(detectCapabilities(insecure).clipboard).toBe('legacy');
  });
  it('says "none" rather than pretending, when neither path exists', () => {
    expect(detectCapabilities({ isSecureContext: false, navigator: {}, document: {} })).toEqual({ secureContext: false, clipboard: 'none', microphone: false });
    expect(detectCapabilities({})).toEqual({ secureContext: false, clipboard: 'none', microphone: false });
  });
  it('reports a microphone only where one could actually be asked for', () => {
    expect(detectCapabilities(view({ isSecureContext: true, navigator: { mediaDevices: { getUserMedia: () => {} } } })).microphone).toBe(true);
    expect(detectCapabilities(view({ isSecureContext: false, navigator: { mediaDevices: { getUserMedia: () => {} } } })).microphone).toBe(false);
    expect(detectCapabilities(view({ isSecureContext: true, navigator: { mediaDevices: {} } })).microphone).toBe(false);
  });
  it('describes each clipboard state in one plain sentence', () => {
    expect(describeClipboard('async')).toContain('clipboard API');
    expect(describeClipboard('legacy')).toContain('older method');
    expect(describeClipboard('none')).toContain('select the text');
  });
});
