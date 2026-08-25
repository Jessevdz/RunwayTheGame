import { describe, it, expect, beforeEach } from 'vitest';
import {
  recordDiagnostic,
  diagnosticSnapshot,
  clearDiagnostics,
  redactSecrets
} from './errorBuffer';

describe('redactSecrets', () => {
  it('strips capability tokens out of a query string', () => {
    const redacted = redactSecrets(
      'GET /api/boards/42?edit_token=s3cr3t-value&page=2 failed'
    );
    expect(redacted).not.toContain('s3cr3t-value');
    expect(redacted).toContain('edit_token=<redacted>');
    // Everything that is not a secret survives, or the report is useless.
    expect(redacted).toContain('page=2');
  });

  it('strips bearer tokens and token-bearing hashes', () => {
    expect(redactSecrets('Authorization: Bearer abc.def.ghi')).not.toContain('abc.def.ghi');
    expect(redactSecrets('/design#edit_token=qwerty')).not.toContain('qwerty');
  });
});

describe('the diagnostics ring', () => {
  beforeEach(() => clearDiagnostics());

  it('keeps entries in order and redacts as it records', () => {
    recordDiagnostic('error', 'first');
    recordDiagnostic('request', '401 GET /api/x?token=leaky — nope');

    const entries = diagnosticSnapshot();
    expect(entries).toHaveLength(2);
    expect(entries[0]).toContain('error: first');
    expect(entries[1]).not.toContain('leaky');
  });

  it('drops the oldest past ten entries rather than growing', () => {
    for (let i = 0; i < 25; i += 1) recordDiagnostic('error', `fault ${i}`);

    const entries = diagnosticSnapshot();
    expect(entries).toHaveLength(10);
    expect(entries[9]).toContain('fault 24');
    expect(entries.some((e) => e.includes('fault 0'))).toBe(false);
  });

  it('ignores empty messages and returns a copy callers cannot mutate', () => {
    recordDiagnostic('error', '');
    expect(diagnosticSnapshot()).toHaveLength(0);

    recordDiagnostic('error', 'real');
    diagnosticSnapshot().push('injected');
    expect(diagnosticSnapshot()).toHaveLength(1);
  });
});
