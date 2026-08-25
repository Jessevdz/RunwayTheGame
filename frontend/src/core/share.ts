import { copyText } from './clipboard';

export type ShareOutcome = 'shared' | 'copied' | 'failed';

/** Checks if native Web Share API is supported on a touch/coarse pointer device. */
export function canShareSheet(): boolean {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false;
  if (typeof navigator.share !== 'function') return false;
  return window.matchMedia?.('(pointer: coarse)').matches ?? false;
}

/** Shares URL via native Web Share API if available, otherwise copies to clipboard. */
export async function shareLink(url: string, opts: { title?: string; text?: string } = {}): Promise<ShareOutcome> {
  if (canShareSheet()) {
    try {
      await navigator.share({ url, title: opts.title, text: opts.text });
      return 'shared';
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return 'shared';
      // Anything else — a permissions policy, an unsupported payload — is a
      // genuine failure of the fast path, so fall through to the slow one.
    }
  }
  return (await copyText(url)) ? 'copied' : 'failed';
}
