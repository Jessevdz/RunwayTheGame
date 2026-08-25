/**
 * Playtester bug reports. Filing one is public and rate-limited; reading them
 * back needs the admin session, because a report is correspondence with the
 * operator rather than published content.
 */
import { adminAuth } from './admin';
import { request } from './http';

export type BugSeverity = 'BLOCKER' | 'NORMAL' | 'COSMETIC';
export type BugStatus = 'NEW' | 'TRIAGED' | 'FIXED' | 'WONTFIX';

/** The closed set of diagnostic fields the server will store. */
export interface BugReportContext {
  route: string;
  viewport: string;
  screen: string;
  user_agent: string;
  app_version: string;
  online: boolean;
  errors: string[];
  occurred_at: string;
}

export interface ApiBugReport {
  id: string;
  summary: string;
  details: string;
  severity: BugSeverity;
  status: BugStatus;
  context: BugReportContext;
  created_at: string;
}

export function createBugReport(
  data: { summary: string; details: string; severity: BugSeverity; context: BugReportContext },
  reporterId?: string
): Promise<{ id: string; received: boolean }> {
  return request<{ id: string; received: boolean }>('/api/bug-reports', {
    method: 'POST',
    headers: reporterId ? { 'X-Voter-ID': reporterId } : {},
    body: JSON.stringify(data)
  });
}

export function listBugReports(): Promise<ApiBugReport[]> {
  return request<ApiBugReport[]>('/api/bug-reports', adminAuth());
}

export function updateBugReportStatus(id: string, status: BugStatus): Promise<ApiBugReport> {
  return request<ApiBugReport>(`/api/bug-reports/${id}`, {
    method: 'PUT',
    ...adminAuth(),
    body: JSON.stringify({ status })
  });
}

export function deleteBugReport(id: string): Promise<{ id: string; deleted: boolean }> {
  return request<{ id: string; deleted: boolean }>(`/api/bug-reports/${id}`, {
    method: 'DELETE',
    ...adminAuth()
  });
}
