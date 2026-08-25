import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isTrustedApiBaseUrl,
  pinTrustedApiOrigin,
  request,
  ApiError,
  API_BASE_URL
} from './http';

describe('http.ts trusted API base URLs', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('trusts the window origin and rejects arbitrary external/LAN hosts by default', () => {
    expect(isTrustedApiBaseUrl(window.location.origin)).toBe(true);
    expect(isTrustedApiBaseUrl('https://malicious.example.com')).toBe(false);
    expect(isTrustedApiBaseUrl('http://192.168.1.50:8080')).toBe(false);
    expect(isTrustedApiBaseUrl('invalid-url')).toBe(false);
  });

  it('trusts origins registered via pinTrustedApiOrigin', () => {
    const customOrigin = 'http://192.168.1.100:8080';
    expect(isTrustedApiBaseUrl(customOrigin)).toBe(false);

    pinTrustedApiOrigin(customOrigin);
    expect(isTrustedApiBaseUrl(customOrigin)).toBe(true);
  });

  it('handles invalid inputs gracefully in pinTrustedApiOrigin', () => {
    pinTrustedApiOrigin('not-a-valid-url');
    expect(isTrustedApiBaseUrl('not-a-valid-url')).toBe(false);
  });
});

describe('http.ts API request handling', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends GET requests to API_BASE_URL with json content type', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, data: 'test' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    const data = await request<{ ok: boolean; data: string }>('/api/test');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API_BASE_URL}/api/test`);
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect((init.headers as Record<string, string>)['Authorization']).toBeUndefined();
    expect(data).toEqual({ ok: true, data: 'test' });
  });

  it('attaches Bearer token in Authorization header when token is provided', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ secret: 'accessed' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    await request<{ secret: string }>('/api/secure', { token: 'AUTH-TOKEN-123' });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer AUTH-TOKEN-123');
  });

  it('handles 204 No Content response as undefined', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 204 })
    );

    const result = await request<void>('/api/action', { method: 'POST' });
    expect(result).toBeUndefined();
  });

  it('throws ApiError with error body on failed responses', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Game not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    await expect(request('/api/games/nonexistent')).rejects.toThrow(ApiError);
  });
});
