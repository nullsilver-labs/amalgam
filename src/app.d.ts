import type { Principal } from '$lib/server/auth';

declare global {
  namespace App {
    interface Locals {
      /** Who is making this request: a browser session, an integration token, or nobody yet. */
      principal: Principal | null;
      /** Whether the socket peer is one of AMALGAM_TRUSTED_PROXIES — set once, in the hook. */
      peerTrusted: boolean;
    }
  }
}

export {};
