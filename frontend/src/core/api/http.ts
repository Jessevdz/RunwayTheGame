/** Core HTTP request client and utility methods. */
import { recordDiagnostic } from '../diagnostics/errorBuffer';

// A caller-supplied api base is only honoured when it names an origin this
// device has previously registered; an IP-range guess never decides trust.
const PINNED_ORIGINS_KEY = 'runway:trusted-api-origins';
const DEV_SERVER_PORTS = new Set(['5173', '4173', '3000']);
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

const configuredBase: string | null = import.meta.env?.VITE_API_BASE_URL || null;

// The api override is consumed once and scrubbed from the URL so a later page
// load cannot silently re-route capability traffic through a stale query param.
const explicitApiBase: string | null = (() => {
  const params = new URLSearchParams(window.location.search);
  const v = params.get('api');
  if (v) {
    const url = new URL(window.location.href);
    url.searchParams.delete('api');
    window.history.replaceState(window.history.state, '', url.toString());
  }
  return v || configuredBase;
})();

function isLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (LOOPBACK_HOSTS.has(h) || h === '0.0.0.0' || h === '::') return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (v4) return v4[1] === '127';
  return false;
}

function configuredOrigin(): string | null {
  if (!configuredBase) return null;
  try {
    return new URL(configuredBase).origin;
  } catch {
    return null;
  }
}

function readPinnedOrigins(): Set<string> {
  try {
    const raw = window.localStorage.getItem(PINNED_ORIGINS_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((x): x is string => typeof x === 'string'));
  } catch {
    return new Set();
  }
}

/** Registers a backend origin this device has deliberately chosen to trust. */
export function pinTrustedApiOrigin(origin: string): void {
  let u: URL;
  try {
    u = new URL(origin);
  } catch {
    return;
  }
  const set = readPinnedOrigins();
  set.add(u.origin);
  try {
    window.localStorage.setItem(PINNED_ORIGINS_KEY, JSON.stringify([...set]));
  } catch {
    // localStorage may be unavailable; a pinned origin is an optimisation.
  }
}

/** True only when a base is the app's own origin or a previously registered backend. */
export function isTrustedApiBaseUrl(value: string, defaultOrigin: string = window.location.origin): boolean {
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return false;
  }
  if (u.origin === new URL(defaultOrigin).origin) return true;
  if (configuredOrigin() === u.origin) return true;
  return readPinnedOrigins().has(u.origin);
}

function resolveApiBaseUrl(): string {
  if (explicitApiBase) {
    const candidate = String(explicitApiBase).replace(/\/+$/, '');
    // Only honour a caller-supplied backend origin that was previously
    // registered; an unpinned ?api= would otherwise exfiltrate tokens.
    if (isTrustedApiBaseUrl(candidate)) return candidate;
  }

  const { protocol, hostname, port } = window.location;
  if (DEV_SERVER_PORTS.has(port)) {
    return `${protocol}//${hostname}:8080`;
  }
  return window.location.origin;
}

export const API_BASE_URL = resolveApiBaseUrl();

export const WS_BASE_URL = API_BASE_URL.replace(/^http/, 'ws');

/** Returns shareable API base URL unless hostname is loopback. */
export function shareableApiBase(): string | null {
  if (!explicitApiBase) return null;
  try {
    if (isLoopbackHost(new URL(API_BASE_URL).hostname)) return null;
  } catch {
    return null;
  }
  return API_BASE_URL;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Extracts human-readable error messages from failed response bodies, falling back to status text. */
async function errorMessage(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  if (text) {
    try {
      const body = JSON.parse(text) as { error?: unknown };
      if (typeof body?.error === 'string' && body.error) return body.error;
    } catch {
      // Fall through to raw text if response is not JSON.
    }
  }
  return text || res.statusText;
}

/** Options interface for HTTP requests with optional Bearer authorization token. */
interface RequestOptions extends RequestInit {
  token?: string;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { token, ...init } = options;
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });
  if (!res.ok) {
    const message = await errorMessage(res);
    // Feed the bug reporter, so a report says which call failed and how.
    recordDiagnostic('request', `${res.status} ${init.method ?? 'GET'} ${path} — ${message}`);
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/** Raised when an evidence upload is abandoned through its AbortSignal. */
export class UploadAbortedError extends Error {
  constructor() {
    super('Evidence upload aborted');
    this.name = 'UploadAbortedError';
  }
}

/** Uploads evidence binary blob directly to a presigned URL using XHR. */
export function uploadToPresignedUrl(
  url: string,
  blob: Blob,
  contentType: string,
  onProgress?: (pct: number) => void,
  signal?: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new UploadAbortedError());
      return;
    }

    const xhr = new XMLHttpRequest();
    // Abandoning the request frees the uplink instead of racing its replacement.
    const abort = () => xhr.abort();
    const detach = () => signal?.removeEventListener('abort', abort);
    signal?.addEventListener('abort', abort);

    xhr.open('PUT', url, true);
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      detach();
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new ApiError(xhr.status, `Upload failed: ${xhr.statusText}`));
    };
    xhr.onerror = () => {
      detach();
      reject(new Error('Network error during evidence upload'));
    };
    xhr.onabort = () => {
      detach();
      reject(new UploadAbortedError());
    };
    xhr.send(blob);
  });
}
