/*
 * What this browser can actually do, asked rather than assumed.
 *
 * A page served over plain HTTP to anything but localhost is not a secure
 * context, and no amount of VPN makes it one: the async clipboard API and
 * getUserMedia are simply absent there. Rather than let a feature fail
 * silently, the app detects the state and Settings › Access says it plainly.
 *
 * Pure, so it can be tested against a plain object shaped like a window.
 */

export type ClipboardMode = 'async' | 'legacy' | 'none';

export interface Capabilities {
  /** window.isSecureContext: https, or a loopback address. */
  secureContext: boolean;
  /** 'async' is the modern API; 'legacy' is execCommand inside a user gesture; 'none' means offer selection instead. */
  clipboard: ClipboardMode;
  /** A microphone could be requested here. Reported only — nothing records yet. */
  microphone: boolean;
}

/** The shape this reads from a real `window`. Every field is optional: old and odd browsers exist. */
export interface BrowserLike {
  isSecureContext?: boolean;
  navigator?: {
    clipboard?: { writeText?: unknown } | undefined;
    mediaDevices?: { getUserMedia?: unknown } | undefined;
  };
  document?: { execCommand?: unknown };
}

export function detectCapabilities(view: BrowserLike | undefined = globalThis as unknown as BrowserLike): Capabilities {
  const secureContext = Boolean(view?.isSecureContext);
  const asyncClipboard = secureContext && typeof view?.navigator?.clipboard?.writeText === 'function';
  const legacyClipboard = typeof view?.document?.execCommand === 'function';
  return {
    secureContext,
    clipboard: asyncClipboard ? 'async' : legacyClipboard ? 'legacy' : 'none',
    microphone: secureContext && typeof view?.navigator?.mediaDevices?.getUserMedia === 'function'
  };
}

/** One plain sentence per capability, for the Access panel. */
export function describeClipboard(mode: ClipboardMode): string {
  return mode === 'async' ? 'Copy uses the browser clipboard API.'
    : mode === 'legacy' ? 'Copy falls back to the older method, which works inside a click.'
    : 'Copying is unavailable — select the text instead.';
}
