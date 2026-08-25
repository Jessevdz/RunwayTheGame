/** Admin authentication and session management API routes. */
import { request } from './http';

const CSRF_STORAGE_KEY = 'runway.admin.csrf';

export interface AdminSession {
  valid: boolean;
  csrf_token: string;
  expires_at: string;
}

/** Session storage, so the console survives a reload but not a closed tab. */
function readStoredCsrf(): string | null {
  try {
    return window.sessionStorage.getItem(CSRF_STORAGE_KEY);
  } catch {
    return null;
  }
}

let csrfToken: string | null = readStoredCsrf();

function storeCsrf(token: string | null): void {
  csrfToken = token;
  try {
    if (token) window.sessionStorage.setItem(CSRF_STORAGE_KEY, token);
    else window.sessionStorage.removeItem(CSRF_STORAGE_KEY);
  } catch {
    // Private-mode browsers refuse storage; the in-memory copy still serves this tab.
  }
}

/** Returns request headers and credentials for authenticated admin requests. */
export function adminAuth(): { credentials: RequestCredentials; headers: Record<string, string> } {
  return {
    credentials: 'include',
    headers: csrfToken ? { 'X-Admin-CSRF': csrfToken } : {}
  };
}

/** Spends the admin key for a session. This is the only call that sees the key. */
export async function startAdminSession(key: string): Promise<AdminSession> {
  const session = await request<AdminSession>('/api/admin/session', {
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify({ key })
  });
  storeCsrf(session.csrf_token);
  return session;
}

/** Verifies whether current browser admin session cookie is still valid. */
export async function resumeAdminSession(): Promise<boolean> {
  if (!csrfToken) return false;
  try {
    await request<{ valid: boolean }>('/api/admin/verify', adminAuth());
    return true;
  } catch {
    storeCsrf(null);
    return false;
  }
}

/** Ends the session on the server and forgets it here, whatever the server says. */
export async function endAdminSession(): Promise<void> {
  try {
    await request<void>('/api/admin/session', { method: 'DELETE', ...adminAuth() });
  } catch {
    // A session that cannot be revoked remotely is still one this browser drops.
  } finally {
    storeCsrf(null);
  }
}
