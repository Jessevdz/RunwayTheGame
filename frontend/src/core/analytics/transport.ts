import { API_BASE_URL } from '../api/client';
import type { AnalyticsEventName, AnalyticsProps } from './events';

export interface QueuedEvent {
  name: AnalyticsEventName;
  props?: AnalyticsProps;
}

export const ANALYTICS_PATH = '/api/analytics';

/** Transmits a batch of analytics events to the server endpoint. */
export function sendBatch(
  sessionId: string,
  events: QueuedEvent[],
  duringUnload: boolean
): Promise<'ok' | 'refused' | 'failed'> {
  const body = JSON.stringify({ session_id: sessionId, events });

  // Use simple text/plain content type to avoid preflight CORS requests during unload.
  const contentType = 'text/plain;charset=UTF-8';

  if (duringUnload && typeof navigator !== 'undefined' && navigator.sendBeacon) {
    // Queue batch via Beacon API when page is unloading.
    const queued = navigator.sendBeacon(
      `${API_BASE_URL}${ANALYTICS_PATH}`,
      new Blob([body], { type: contentType })
    );
    return Promise.resolve(queued ? 'ok' : 'failed');
  }

  return fetch(`${API_BASE_URL}${ANALYTICS_PATH}`, {
    method: 'POST',
    body,
    headers: { 'Content-Type': contentType },
    // Ensure request survives page navigation.
    keepalive: true
  })
    .then((res) => {
      // Flag 4xx responses as permanent rejection.
      if (res.status >= 400 && res.status < 500) return 'refused' as const;
      if (!res.ok) return 'failed' as const;
      return 'ok' as const;
    })
    .catch(() => 'failed' as const);
}
