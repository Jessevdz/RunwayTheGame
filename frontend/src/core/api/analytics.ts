/** Admin-only read side of usage analytics. Every figure here is an aggregate. */
import { request } from './http';
import { adminAuth } from './admin';

export interface AnalyticsDay {
  day: string;
  events: number;
  sessions: number;
}

export interface AnalyticsEventCount {
  name: string;
  events: number;
  sessions: number;
}

export interface AnalyticsValue {
  value: string;
  count: number;
}

export interface AnalyticsBreakdown {
  name: string;
  prop: string;
  values: AnalyticsValue[];
}

export interface AnalyticsOverview {
  days: number;
  since: string;
  /** False when the server is not recording, which makes empty figures expected. */
  enabled: boolean;
  totals: { events: number; sessions: number; active_days: number };
  daily: AnalyticsDay[];
  events: AnalyticsEventCount[];
  breakdowns: AnalyticsBreakdown[];
}

/** Fetches aggregated usage for a window of days ending today. */
export function getAnalyticsOverview(days: number): Promise<AnalyticsOverview> {
  return request<AnalyticsOverview>(`/api/admin/analytics?days=${days}`, adminAuth());
}
