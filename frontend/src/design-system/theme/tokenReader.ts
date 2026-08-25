import { TOKEN_FALLBACKS } from './tokens.generated';

let probeEl: HTMLElement | null = null;
const tokenCache = new Map<string, string>();

function getProbeElement(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  if (!probeEl) {
    probeEl = document.createElement('div');
    probeEl.setAttribute('data-token-probe', 'true');
    probeEl.style.cssText =
      'position:absolute;left:-100vw;top:-100vh;visibility:hidden;pointer-events:none;';
    document.documentElement.appendChild(probeEl);
  }
  return probeEl;
}

export function resolveToken(tokenName: string): string {
  if (tokenCache.has(tokenName)) {
    return tokenCache.get(tokenName)!;
  }

  const probe = getProbeElement();
  if (!probe) {
    return TOKEN_FALLBACKS[tokenName] ?? TOKEN_FALLBACKS['--ink'];
  }

  try {
    probe.style.color = `var(${tokenName})`;
    const resolved = window.getComputedStyle(probe).color;
    if (resolved && resolved !== '' && resolved !== 'rgba(0, 0, 0, 0)') {
      tokenCache.set(tokenName, resolved);
      return resolved;
    }
  } catch {
    // fallback
  }

  const fallback = TOKEN_FALLBACKS[tokenName] ?? TOKEN_FALLBACKS['--ink'];
  tokenCache.set(tokenName, fallback);
  return fallback;
}

export function refreshTokens(): void {
  tokenCache.clear();
}

export function onTokenChange(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = () => {
    refreshTokens();
    callback();
  };
  document.addEventListener('runway:themechange', handler);
  return () => {
    document.removeEventListener('runway:themechange', handler);
  };
}
