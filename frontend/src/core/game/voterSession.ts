import { getString, setString } from '../util/storage';

const VOTER_ID_KEY = 'runway_voter_id';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Returns the persistent voter ID stored in localStorage, generating a new UUIDv4 if missing.
 */
export function getOrCreateVoterId(): string {
  const existing = getString(VOTER_ID_KEY);
  if (existing && UUID_REGEX.test(existing)) {
    return existing;
  }
  const fresh = crypto.randomUUID();
  setString(VOTER_ID_KEY, fresh);
  return fresh;
}
