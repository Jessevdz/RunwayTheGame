import { describe, it, expect, beforeEach } from 'vitest';
import { ingestPlaytestFlag, isPlaytester, disablePlaytestMode } from './playtest';

/** Resets both the URL and the stored flag between cases. */
function visit(url: string): void {
  window.history.replaceState(null, '', url);
}

describe('the playtest gate', () => {
  beforeEach(() => {
    localStorage.clear();
    disablePlaytestMode();
    visit('/');
  });

  it('is off for an ordinary visitor', () => {
    ingestPlaytestFlag();
    expect(isPlaytester()).toBe(false);
  });

  it('turns on from a query flag and scrubs it from the address bar', () => {
    visit('/race/abc?playtest=1&keep=yes');
    ingestPlaytestFlag();

    expect(isPlaytester()).toBe(true);
    expect(window.location.search).not.toContain('playtest');
    // Unrelated parameters are left alone.
    expect(window.location.search).toContain('keep=yes');
  });

  it('turns on from a hash flag too', () => {
    visit('/gallery#playtest=1');
    ingestPlaytestFlag();

    expect(isPlaytester()).toBe(true);
    expect(window.location.hash).not.toContain('playtest');
  });

  it('turns off again on playtest=0', () => {
    visit('/?playtest=1');
    ingestPlaytestFlag();
    expect(isPlaytester()).toBe(true);

    visit('/?playtest=0');
    ingestPlaytestFlag();
    expect(isPlaytester()).toBe(false);
  });

  it('survives a reload once set, without the flag in the URL', () => {
    visit('/?playtest=1');
    ingestPlaytestFlag();

    visit('/some/other/page');
    ingestPlaytestFlag();
    expect(isPlaytester()).toBe(true);
  });
});
