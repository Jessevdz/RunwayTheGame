/**
 * The playtest gate. Bug reporting is meant for the people testing this alpha,
 * not for every visitor who lands on the gallery, so the affordance is hidden
 * until a browser is marked as a tester's.
 *
 * Marking is one link: share `?playtest=1` (or `#playtest=1`) once and that
 * browser keeps the flag. This is a UI preference, not a credential — the
 * endpoint behind it is public and rate-limited either way, so nothing here
 * needs to be unguessable.
 */
import { getString, setString, removeItem } from '../util/storage';

const PLAYTEST_KEY = 'runway.playtest';

let enabled: boolean | null = null;

/** Reads the flag from the URL, persists it, and scrubs it from the address bar. */
export function ingestPlaytestFlag(): void {
  if (typeof window === 'undefined') return;

  const search = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const raw = search.get('playtest') ?? hash.get('playtest');
  if (raw === null) return;

  const on = raw !== '0' && raw !== 'false';
  if (on) setString(PLAYTEST_KEY, '1');
  else removeItem(PLAYTEST_KEY);
  enabled = on;

  // Same hygiene the board edit_token gets: ingest it, then take it out of the
  // address bar so it is not carried into a screenshot or a shared link.
  search.delete('playtest');
  hash.delete('playtest');
  const query = search.toString();
  const fragment = hash.toString();
  window.history.replaceState(
    null,
    '',
    `${window.location.pathname}${query ? `?${query}` : ''}${fragment ? `#${fragment}` : ''}`
  );
}

/** Whether this browser is marked as a playtester's. */
export function isPlaytester(): boolean {
  if (enabled !== null) return enabled;
  enabled = getString(PLAYTEST_KEY) === '1';
  return enabled;
}

/** Turns the flag off for this browser, used by the dialog's opt-out. */
export function disablePlaytestMode(): void {
  removeItem(PLAYTEST_KEY);
  enabled = false;
}
