/** Seam letting the HTTP client report failures without importing the analytics client. */
import { routeShape } from './routeShape';

/** Status reported when the request never produced a response at all. */
export const NETWORK_FAILURE_STATUS = 0;

export type RequestFailureSink = (route: string, status: string) => void;

let sink: RequestFailureSink | null = null;

/** Registers the reporter; the analytics client installs itself here on init. */
export function setRequestFailureSink(fn: RequestFailureSink | null): void {
  sink = fn;
}

/**
 * Reports a failed API call as an allowlisted route shape and status. The
 * analytics endpoint is excluded, so a telemetry outage cannot report itself.
 */
export function reportRequestFailure(path: string, method: string, status: number): void {
  if (!sink) return;
  if (path.startsWith('/api/analytics')) return;
  sink(routeShape(path, method), String(status));
}
