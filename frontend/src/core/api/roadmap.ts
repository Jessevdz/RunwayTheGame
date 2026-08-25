// The community roadmap. Nothing here touches a race: the only credentials are
// a voter id (vote dedupe) and the admin session (curation).
import { adminAuth } from './admin';
import { request } from './http';

export interface ApiRoadmapItem {
  id: string;
  title: string;
  description: string;
  status: 'PROPOSED' | 'PLANNED' | 'IN_PROGRESS' | 'SHIPPED';
  vote_count: number;
  voted: boolean;
  is_hidden?: boolean;
  created_at: string;
}

/**
 * The roadmap as this caller may see it. An admin session additionally returns
 * items hidden by community flags, so curation has something to act on.
 */
export function listRoadmapItems(voterId?: string, asAdmin = false): Promise<ApiRoadmapItem[]> {
  const params = new URLSearchParams();
  if (voterId) params.set('voter_id', voterId);
  const query = params.toString() ? `?${params.toString()}` : '';

  const auth = asAdmin ? adminAuth() : { credentials: undefined, headers: {} };
  const headers: Record<string, string> = { ...auth.headers };
  if (voterId) headers['X-Voter-ID'] = voterId;

  return request<ApiRoadmapItem[]>(`/api/roadmap${query}`, {
    credentials: auth.credentials,
    headers
  });
}

export function createRoadmapItem(data: { title: string; description?: string }): Promise<ApiRoadmapItem> {
  return request<ApiRoadmapItem>('/api/roadmap', {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export function updateRoadmapItem(
  id: string,
  data: { title?: string; description?: string; status?: ApiRoadmapItem['status']; is_hidden?: boolean }
): Promise<ApiRoadmapItem> {
  return request<ApiRoadmapItem>(`/api/roadmap/${id}`, {
    method: 'PUT',
    ...adminAuth(),
    body: JSON.stringify(data)
  });
}

export function deleteRoadmapItem(id: string): Promise<{ id: string; deleted: boolean }> {
  return request<{ id: string; deleted: boolean }>(`/api/roadmap/${id}`, {
    method: 'DELETE',
    ...adminAuth()
  });
}

export function voteRoadmapItem(id: string, voterId: string): Promise<{ id: string; vote_count: number; voted: boolean }> {
  return request<{ id: string; vote_count: number; voted: boolean }>(`/api/roadmap/${id}/vote`, {
    method: 'POST',
    headers: { 'X-Voter-ID': voterId }
  });
}

export function unvoteRoadmapItem(id: string, voterId: string): Promise<{ id: string; vote_count: number; voted: boolean }> {
  return request<{ id: string; vote_count: number; voted: boolean }>(`/api/roadmap/${id}/vote`, {
    method: 'DELETE',
    headers: { 'X-Voter-ID': voterId }
  });
}

export function flagRoadmapItem(id: string, voterId: string): Promise<{ id: string; flagged: boolean }> {
  return request<{ id: string; flagged: boolean }>(`/api/roadmap/${id}/flag`, {
    method: 'POST',
    headers: { 'X-Voter-ID': voterId }
  });
}
