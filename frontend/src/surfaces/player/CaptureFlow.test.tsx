import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CaptureFlow } from './CaptureFlow';
import * as client from '../../core/api/client';
import type { TeamSession } from '../../core/game/teamSession';

vi.mock('../../core/api/client', () => ({
  presignUpload: vi.fn(),
  uploadToPresignedUrl: vi.fn(),
  submitChallengeEvidence: vi.fn(),
  clearRoadblock: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  }
}));

describe('CaptureFlow', () => {
  const dummySession: TeamSession = {
    gameId: 'test-game-123',
    teamId: 'team-456',
    teamToken: 'token-789',
    teamName: 'Red Team',
    slotIndex: 0,
    homeWaypointId: 'wp-0'
  };

  const initialLocation = {
    lat: 51.5074,
    lon: -0.1278,
    accuracy: 5.0,
    heading: null,
    speed: null,
    timestamp: Date.now()
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders challenge brief and transitions to review on mock photo click', async () => {
    const user = userEvent.setup();
    render(
      <CaptureFlow
        waypointId="wp-1"
        challengeId="ch-1"
        prompt="Take a picture of the cathedral"
        rubric={{
          must_show: ['spire', 'clock'],
          fails_if: ['blurry'],
          acceptable_ambiguity: 'partial view ok'
        }}
        session={dummySession}
        verification="trust"
        playerLocation={initialLocation}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('Take a picture of the cathedral')).toBeInTheDocument();
    expect(screen.getByText('spire')).toBeInTheDocument();

    const mockPhotoBtn = screen.getByRole('button', { name: /use mock photo/i });
    await user.click(mockPhotoBtn);

    expect(screen.getByRole('button', { name: /submit/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retake/i })).toBeInTheDocument();
  });

  it('does not restart upload when playerLocation updates during submission', async () => {
    const user = userEvent.setup();

    let resolveUpload: () => void;
    const uploadPromise = new Promise<void>((resolve) => {
      resolveUpload = resolve;
    });

    vi.mocked(client.presignUpload).mockResolvedValue({
      upload_url: 'https://upload.example.com/blob',
      blob_ref: 'games/test/photo.jpg'
    });
    vi.mocked(client.uploadToPresignedUrl).mockReturnValue(uploadPromise as any);
    vi.mocked(client.submitChallengeEvidence).mockResolvedValue({
      submission_id: 'sub-1',
      status: 'pass'
    });

    const { rerender } = render(
      <CaptureFlow
        waypointId="wp-1"
        challengeId="ch-1"
        prompt="Take a picture of the cathedral"
        rubric={{ must_show: [], fails_if: [], acceptable_ambiguity: '' }}
        session={dummySession}
        verification="trust"
        playerLocation={initialLocation}
        onClose={vi.fn()}
      />
    );

    // Pick mock photo
    await user.click(screen.getByRole('button', { name: /use mock photo/i }));

    // Click Submit
    await user.click(screen.getByRole('button', { name: /submit/i }));

    expect(client.presignUpload).toHaveBeenCalledTimes(1);
    expect(client.uploadToPresignedUrl).toHaveBeenCalledTimes(1);

    // Simulate multiple GPS location updates streaming in during upload
    for (let i = 1; i <= 5; i++) {
      rerender(
        <CaptureFlow
          waypointId="wp-1"
          challengeId="ch-1"
          prompt="Take a picture of the cathedral"
          rubric={{ must_show: [], fails_if: [], acceptable_ambiguity: '' }}
          session={dummySession}
          verification="trust"
          playerLocation={{
            ...initialLocation,
            lat: initialLocation.lat + i * 0.0001,
            lon: initialLocation.lon + i * 0.0001
          }}
          onClose={vi.fn()}
        />
      );
    }

    // presignUpload and uploadToPresignedUrl must NOT have been called again
    expect(client.presignUpload).toHaveBeenCalledTimes(1);
    expect(client.uploadToPresignedUrl).toHaveBeenCalledTimes(1);

    // Complete upload
    await act(async () => {
      resolveUpload!();
    });

    await waitFor(() => {
      expect(client.submitChallengeEvidence).toHaveBeenCalledTimes(1);
    });

    // In trust mode, status is 'pass', should display approved verdict immediately
    await waitFor(() => {
      expect(screen.getByText(/verdict: approved/i)).toBeInTheDocument();
    });
  });

  it('handles submission error gracefully and returns to review stage with retry', async () => {
    const user = userEvent.setup();

    vi.mocked(client.presignUpload).mockRejectedValueOnce(new Error('Network disconnected'));

    render(
      <CaptureFlow
        waypointId="wp-1"
        challengeId="ch-1"
        prompt="Take a picture of the cathedral"
        rubric={{ must_show: [], fails_if: [], acceptable_ambiguity: '' }}
        session={dummySession}
        verification="trust"
        playerLocation={initialLocation}
        onClose={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: /use mock photo/i }));
    await user.click(screen.getByRole('button', { name: /submit/i }));

    await waitFor(() => {
      expect(screen.getByText(/upload failed/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    });
  });

  it('aborts the in-flight upload when the capture flow unmounts', async () => {
    const user = userEvent.setup();

    let seenSignal: AbortSignal | undefined;
    vi.mocked(client.presignUpload).mockResolvedValue({
      upload_url: 'https://upload.example.com/blob',
      blob_ref: 'games/test/photo.jpg'
    });
    vi.mocked(client.uploadToPresignedUrl).mockImplementation(
      (_url, _blob, _contentType, _onProgress, signal) => {
        seenSignal = signal;
        return new Promise<void>(() => {});
      }
    );

    const { unmount } = render(
      <CaptureFlow
        waypointId="wp-1"
        challengeId="ch-1"
        prompt="Take a picture of the cathedral"
        rubric={{ must_show: [], fails_if: [], acceptable_ambiguity: '' }}
        session={dummySession}
        verification="trust"
        playerLocation={initialLocation}
        onClose={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: /use mock photo/i }));
    await user.click(screen.getByRole('button', { name: /submit/i }));

    await waitFor(() => expect(seenSignal).toBeDefined());
    expect(seenSignal!.aborted).toBe(false);

    unmount();
    expect(seenSignal!.aborted).toBe(true);
  });

  it('aborts the in-flight upload when the player discards it', async () => {
    const user = userEvent.setup();

    let seenSignal: AbortSignal | undefined;
    vi.mocked(client.presignUpload).mockResolvedValue({
      upload_url: 'https://upload.example.com/blob',
      blob_ref: 'games/test/photo.jpg'
    });
    vi.mocked(client.uploadToPresignedUrl).mockImplementation(
      (_url, _blob, _contentType, _onProgress, signal) => {
        seenSignal = signal;
        return new Promise<void>(() => {});
      }
    );

    render(
      <CaptureFlow
        waypointId="wp-1"
        challengeId="ch-1"
        prompt="Take a picture of the cathedral"
        rubric={{ must_show: [], fails_if: [], acceptable_ambiguity: '' }}
        session={dummySession}
        verification="trust"
        playerLocation={initialLocation}
        onClose={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: /use mock photo/i }));
    await user.click(screen.getByRole('button', { name: /submit/i }));
    await waitFor(() => expect(seenSignal).toBeDefined());

    // Dismissing mid-upload asks for confirmation before throwing the photo away.
    await user.click(screen.getByRole('button', { name: /close dialog/i }));
    await user.click(screen.getByRole('button', { name: /^discard$/i }));
    expect(seenSignal!.aborted).toBe(true);
  });
});
