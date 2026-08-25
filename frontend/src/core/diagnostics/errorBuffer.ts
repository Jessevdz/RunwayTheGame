/**
 * A small in-memory ring of the most recent client faults, so a bug report can
 * say what the app did rather than only what the tester saw.
 *
 * Nothing here is sent anywhere on its own: the buffer is read only when a
 * playtester presses Report, and it lives in a module variable that dies with
 * the page. It is not analytics, and it does not touch storage of any kind.
 */

/** How many faults are retained; the oldest is dropped past this. */
const MAX_ENTRIES = 10;

/** A single captured fault, already redacted and stringified. */
let entries: string[] = [];
let installed = false;

/**
 * Capability tokens travel in URLs (a board edit_token, a race host token), and
 * a stack trace or a failed-request message can quote one. Anything that looks
 * like a secret is replaced before it is ever held in the buffer.
 */
const SECRET_PARAM = /\b(edit_token|host_token|token|key|admin_key|csrf)=[^&\s"']+/gi;
const BEARER = /\bBearer\s+[\w.-]+/gi;
const URL_HASH_SECRET = /#[\w-]*token[\w-]*=[^&\s"']+/gi;

export function redactSecrets(text: string): string {
  return text
    .replace(SECRET_PARAM, (_m, name: string) => `${name}=<redacted>`)
    .replace(BEARER, 'Bearer <redacted>')
    .replace(URL_HASH_SECRET, '#<redacted>');
}

/** Formats a fault with a wall-clock stamp so ordering survives the round trip. */
function stamp(kind: string, message: string): string {
  const at = new Date().toISOString().slice(11, 19);
  return redactSecrets(`[${at}] ${kind}: ${message}`).slice(0, 400);
}

/** Records one fault, evicting the oldest once the ring is full. */
export function recordDiagnostic(kind: string, message: string): void {
  try {
    if (!message) return;
    entries.push(stamp(kind, message));
    if (entries.length > MAX_ENTRIES) entries = entries.slice(-MAX_ENTRIES);
  } catch {
    // A diagnostics buffer must never be the thing that breaks a race.
  }
}

/** Returns the buffered faults, oldest first. */
export function diagnosticSnapshot(): string[] {
  return [...entries];
}

/** Empties the buffer, used after a report is filed and by tests. */
export function clearDiagnostics(): void {
  entries = [];
}

/** Subscribes to uncaught errors and rejected promises exactly once. */
export function installDiagnostics(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  window.addEventListener('error', (event: ErrorEvent) => {
    const where = event.filename ? ` (${event.filename}:${event.lineno})` : '';
    recordDiagnostic('error', `${event.message}${where}`);
  });

  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    const message =
      reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason);
    recordDiagnostic('unhandled', message);
  });
}
