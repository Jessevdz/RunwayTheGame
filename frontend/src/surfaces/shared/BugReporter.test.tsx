import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { BugReporter } from './BugReporter';
import { ingestPlaytestFlag, disablePlaytestMode } from '../../core/diagnostics/playtest';
import { recordDiagnostic, clearDiagnostics } from '../../core/diagnostics/errorBuffer';

const createBugReport = vi.hoisted(() => vi.fn());

vi.mock('../../core/api/client', () => ({ createBugReport }));

/** Marks this browser as a playtester's, the way the shared link does. */
function markPlaytester(): void {
  window.history.replaceState(null, '', '/race/abc?playtest=1');
  ingestPlaytestFlag();
}

function renderReporter() {
  return render(
    <MemoryRouter>
      <BugReporter />
    </MemoryRouter>
  );
}

describe('BugReporter', () => {
  beforeEach(() => {
    localStorage.clear();
    disablePlaytestMode();
    clearDiagnostics();
    createBugReport.mockReset();
    createBugReport.mockResolvedValue({ id: 'report-1', received: true });
    window.history.replaceState(null, '', '/');
  });

  it('shows nothing at all to an ordinary visitor', () => {
    renderReporter();
    expect(screen.queryByRole('button', { name: /report a bug/i })).not.toBeInTheDocument();
  });

  it('offers the button to a playtester on any route', () => {
    markPlaytester();
    renderReporter();
    expect(screen.getByRole('button', { name: /report a bug/i })).toBeInTheDocument();
  });

  it('files a report carrying the captured faults, then confirms', async () => {
    const user = userEvent.setup();
    markPlaytester();
    recordDiagnostic('error', 'Cannot read properties of null');
    renderReporter();

    await user.click(screen.getByRole('button', { name: /report a bug/i }));
    await user.type(
      screen.getByPlaceholderText(/the finish button did nothing/i),
      'Roadblock card never cleared'
    );
    await user.click(screen.getByRole('button', { name: /send report/i }));

    await waitFor(() => expect(createBugReport).toHaveBeenCalledTimes(1));

    const [payload] = createBugReport.mock.calls[0];
    expect(payload.summary).toBe('Roadblock card never cleared');
    expect(payload.severity).toBe('NORMAL');
    expect(payload.context.errors[0]).toContain('Cannot read properties of null');
    // The report says which page it came from, without needing the tester to.
    expect(payload.context.route).toBe('/race/abc');

    expect(await screen.findByText(/sent\. thanks/i)).toBeInTheDocument();
  });

  it('refuses to send an empty report', async () => {
    const user = userEvent.setup();
    markPlaytester();
    renderReporter();

    await user.click(screen.getByRole('button', { name: /report a bug/i }));
    expect(screen.getByRole('button', { name: /send report/i })).toBeDisabled();
    expect(createBugReport).not.toHaveBeenCalled();
  });

  it('surfaces a server refusal instead of pretending it sent', async () => {
    const user = userEvent.setup();
    createBugReport.mockRejectedValue(new Error('rate limit exceeded: please wait'));
    markPlaytester();
    renderReporter();

    await user.click(screen.getByRole('button', { name: /report a bug/i }));
    await user.type(screen.getByPlaceholderText(/the finish button did nothing/i), 'Another one');
    await user.click(screen.getByRole('button', { name: /send report/i }));

    expect(await screen.findByText(/rate limit exceeded/i)).toBeInTheDocument();
    expect(screen.queryByText(/sent\. thanks/i)).not.toBeInTheDocument();
  });

  it('lets someone who is not a tester hide the button for good', async () => {
    const user = userEvent.setup();
    markPlaytester();
    renderReporter();

    await user.click(screen.getByRole('button', { name: /report a bug/i }));
    await user.click(screen.getByRole('button', { name: /not a playtester/i }));

    expect(screen.queryByRole('button', { name: /report a bug/i })).not.toBeInTheDocument();
    expect(localStorage.getItem('runway.playtest')).toBeNull();
  });
});
