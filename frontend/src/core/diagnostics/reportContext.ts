/** Assembles the diagnostic context attached to a bug report. */
import { currentViewport } from '../analytics/events';
import { diagnosticSnapshot, redactSecrets } from './errorBuffer';
import type { BugReportContext } from '../api/bugreports';

/** The build stamp injected by vite; 'dev' when running the dev server. */
declare const __APP_BUILD__: string;

function buildStamp(): string {
  try {
    return typeof __APP_BUILD__ === 'string' ? __APP_BUILD__ : 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Snapshots everything a triager needs and nothing else.
 *
 * The route keeps its ids — a bug in a race is not reproducible without knowing
 * which race — but the query string and hash are dropped, because that is where
 * capability tokens live.
 */
export function collectReportContext(): BugReportContext {
  const route =
    typeof window === 'undefined' ? '' : redactSecrets(window.location.pathname);

  return {
    route,
    viewport: currentViewport(),
    screen:
      typeof window === 'undefined' ? '' : `${window.innerWidth}x${window.innerHeight}`,
    user_agent: typeof navigator === 'undefined' ? '' : navigator.userAgent,
    app_version: buildStamp(),
    online: typeof navigator === 'undefined' ? true : navigator.onLine,
    errors: diagnosticSnapshot(),
    occurred_at: new Date().toISOString()
  };
}

/** Renders a report's context as the plain text block shown to a human. */
export function formatReportContext(context: BugReportContext): string {
  const lines = [
    `page:    ${context.route || 'unknown'}`,
    `build:   ${context.app_version}`,
    `screen:  ${context.screen} (${context.viewport})`,
    `online:  ${context.online ? 'yes' : 'no'}`,
    `client:  ${context.occurred_at}`,
    `browser: ${context.user_agent}`
  ];
  if (context.errors.length === 0) {
    lines.push('errors:  none captured');
  } else {
    lines.push('errors:');
    for (const entry of context.errors) lines.push(`  ${entry}`);
  }
  return lines.join('\n');
}
