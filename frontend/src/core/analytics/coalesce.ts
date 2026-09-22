/** Collapses repeated reports of the same thing into the first one. */

/** A ceiling on memory; a session that passes it simply stops coalescing. */
const MAX_KEYS = 500;

const seen = new Set<string>();

/**
 * Reports whether a key is being seen for the first time this page load. Field
 * edits fire per keystroke, and the question they answer — which fields does a
 * designer touch — is answered once per field.
 */
export function firstTime(key: string): boolean {
  if (seen.has(key)) return false;
  if (seen.size >= MAX_KEYS) return false;
  seen.add(key);
  return true;
}

/** Drops every remembered key; exported for tests. */
export function resetCoalescing(): void {
  seen.clear();
}
