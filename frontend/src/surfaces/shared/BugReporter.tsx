/**
 * The global bug reporter: one floating button, mounted once at the app root,
 * so a playtester can file from any surface without leaving what they were
 * doing. Shake the phone or press Ctrl+Alt+B to get the same dialog.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Dialog, Button, Input, Textarea, Select, Notice } from '@ds';
import { createBugReport } from '../../core/api/client';
import type { BugSeverity, BugReportContext } from '../../core/api/client';
import { getOrCreateVoterId } from '../../core/game/voterSession';
import { collectReportContext, formatReportContext } from '../../core/diagnostics/reportContext';
import { clearDiagnostics } from '../../core/diagnostics/errorBuffer';
import { isPlaytester, disablePlaytestMode } from '../../core/diagnostics/playtest';
import { useShakeGesture } from '../../core/diagnostics/useShakeGesture';

/** How long the thank-you stays up before the dialog closes itself. */
const SENT_DISMISS_MS = 1600;

export const BugReporter: React.FC = () => {
  const location = useLocation();
  const [visible, setVisible] = useState<boolean>(() => isPlaytester());
  const [open, setOpen] = useState(false);

  const [summary, setSummary] = useState('');
  const [details, setDetails] = useState('');
  const [severity, setSeverity] = useState<BugSeverity>('NORMAL');
  const [context, setContext] = useState<BugReportContext | null>(null);
  const [showContext, setShowContext] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  // The flag can be ingested from a link mid-session, so re-check on navigation.
  useEffect(() => {
    setVisible(isPlaytester());
  }, [location.pathname]);

  /** Snapshots the context at the moment of opening, not the moment of sending. */
  const openReporter = useCallback(() => {
    if (!isPlaytester()) return;
    setContext(collectReportContext());
    setError(null);
    setSent(false);
    setOpen(true);
  }, []);

  useShakeGesture(visible && !open, openReporter);

  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.altKey && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault();
        openReporter();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, openReporter]);

  const close = useCallback(() => {
    setOpen(false);
    setShowContext(false);
  }, []);

  const handleSubmit = async () => {
    const trimmed = summary.trim();
    if (trimmed.length < 3) {
      setError('Tell us what went wrong, in a few words at least.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await createBugReport(
        {
          summary: trimmed,
          details: details.trim(),
          severity,
          context: context ?? collectReportContext()
        },
        getOrCreateVoterId()
      );
      // The faults just reported are spent; the next report should describe the
      // next problem rather than repeat this one.
      clearDiagnostics();
      setSent(true);
      setSummary('');
      setDetails('');
      setSeverity('NORMAL');
      window.setTimeout(close, SENT_DISMISS_MS);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the report.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleOptOut = () => {
    disablePlaytestMode();
    setVisible(false);
    close();
  };

  if (!visible) return null;

  return (
    <>
      <button
        type="button"
        className="bug-fab"
        onClick={openReporter}
        aria-label="Report a bug"
        title="Report a bug (Ctrl+Alt+B, or shake)"
      >
        <span aria-hidden="true">🐞</span>
      </button>

      <Dialog open={open} title="Report a bug" onClose={close}>
        {sent ? (
          <Notice kind="info">Sent. Thanks — that genuinely helps.</Notice>
        ) : (
          <div className="bug-report-form">
            {error && <Notice kind="stop">{error}</Notice>}

            <Input
              label="What went wrong?"
              placeholder="The finish button did nothing"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
            />

            <Textarea
              label="Anything else? (optional)"
              placeholder="I tapped it twice, the timer kept running, no error appeared."
              rows={3}
              value={details}
              onChange={(e) => setDetails(e.target.value)}
            />

            <Select
              label="How bad is it?"
              value={severity}
              onChange={(e) => setSeverity(e.target.value as BugSeverity)}
            >
              <option value="BLOCKER">Blocker — I cannot keep playing</option>
              <option value="NORMAL">Normal — it is wrong but I worked around it</option>
              <option value="COSMETIC">Cosmetic — it just looks off</option>
            </Select>

            <div className="bug-report-form__context">
              <button
                type="button"
                className="bug-report-form__toggle"
                onClick={() => setShowContext((v) => !v)}
                aria-expanded={showContext}
              >
                {showContext ? 'Hide' : 'Show'} what gets sent with this
              </button>
              {showContext && context && (
                <pre className="bug-report-form__pre">{formatReportContext(context)}</pre>
              )}
            </div>

            <div className="bug-report-form__actions">
              <Button variant="ghost" onClick={close} disabled={submitting}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleSubmit}
                disabled={submitting || summary.trim().length < 3}
              >
                {submitting ? 'Sending…' : 'Send report'}
              </Button>
            </div>

            <button type="button" className="bug-report-form__optout" onClick={handleOptOut}>
              Not a playtester? Hide this button.
            </button>
          </div>
        )}
      </Dialog>
    </>
  );
};
