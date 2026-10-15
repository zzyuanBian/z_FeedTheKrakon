/**
 * Clipboard helper. `navigator.clipboard` needs a secure context (https or
 * localhost) — on a LAN party over plain http it's undefined, so we fall back
 * to the hidden-textarea `execCommand` trick before giving up silently.
 */

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    /* secure-context missing or permission denied — try the legacy path */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** The `?room=` deep link for a match, resolved against the current origin. */
export function roomShareUrl(matchID: string): string {
  return `${window.location.origin}${window.location.pathname}?room=${matchID}`;
}
