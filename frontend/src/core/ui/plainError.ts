import { ApiError } from '../api/client';

const OFFLINE = "Couldn't reach the server. Check your connection and try again.";

/** Turns a thrown value into a short sentence a player can act on, never a raw fetch or HTTP error. */
export function plainError(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    if (err.status >= 500) return 'Something went wrong on our side. Try again in a moment.';
    if (err.status === 404) return "We couldn't find that. It may have been removed.";
    if (err.status === 429) return 'Too many tries. Wait a moment and try again.';
    return err.message && err.message.length < 140 ? err.message : fallback;
  }
  const message = err instanceof Error ? err.message : '';
  if (err instanceof TypeError || /failed to fetch|networkerror|load failed|network request failed/i.test(message)) {
    return OFFLINE;
  }
  return message && message.length < 140 ? message : fallback;
}
