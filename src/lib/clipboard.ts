import { detectCapabilities } from './capabilities';

/*
 * Copy text, wherever the page is served from. The async clipboard API only
 * exists in a secure context — https, or localhost — so an instance reached
 * over plain http on a LAN address has none. The old execCommand path still
 * works there, inside a user gesture, so it is the fallback. Which of the two
 * is available is the same question Settings › Access answers, so it is asked
 * in one place: capabilities.ts.
 */
export async function copyText(text: string): Promise<boolean> {
  const { clipboard } = detectCapabilities();
  if (clipboard === 'none') return false;
  if (clipboard === 'async') {
    try { await navigator.clipboard.writeText(text); return true; }
    catch { /* denied or unavailable — try the legacy path */ }
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.setAttribute('aria-hidden', 'true');
    area.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;';
    document.body.append(area);
    area.select();
    area.setSelectionRange(0, text.length);
    const done = document.execCommand('copy');
    area.remove();
    return done;
  } catch { return false; }
}
