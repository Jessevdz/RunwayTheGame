import React, { useCallback, useEffect, useRef, useState } from 'react';
import { projectionStore, type VerificationMode } from '../../core/projection/projectionStore';
import { generateIdempotencyKey, enqueueAction } from '../../core/projection/offlineStore';
import { presignUpload, uploadToPresignedUrl, submitChallengeEvidence, clearRoadblock, ApiError } from '../../core/api/client';
import { frameFromFile, type CapturedFrame } from '../../core/player/cameraService';
import type { GPSPosition } from '../../core/player/locationService';
import type { TeamSession } from '../../core/game/teamSession';
import { Dialog, Button, Callout, Chip, Notice } from '@ds';
import './capture-flow.css';

interface CaptureFlowProps {
  /** Capture mode ('challenge' or 'roadblock'). */
  mode?: 'challenge' | 'roadblock';
  /** Waypoint being cleared, or the blocked road in roadblock mode. */
  waypointId: string;
  challengeId?: string;
  prompt: string;
  rubric: {
    must_show: string[];
    fails_if: string[];
    acceptable_ambiguity: string;
  };
  session: TeamSession;
  /** Verification mode used to grade photos. */
  verification: VerificationMode;
  /** GPS position of player at capture time. */
  playerLocation: GPSPosition | null;
  /** Callback when background verdict watching is handed off to shell. */
  onWatchVerdict?: (submissionId: string) => void;
  onClose: () => void;
}

/** Stages of evidence capture and submission flow. */
type CaptureStage = 'brief' | 'review' | 'uploading' | 'queued' | 'pending' | 'result';

/** After this long with no verdict, offer to hand the wait off to the shell. */
const PATIENCE_SECONDS = 15;

/** Default rationale message for trust verification mode submissions. */
const TRUST_RATIONALE = 'Accepted on trust: this game grades no photos. Your evidence is stored for the group to look at.';

export const CaptureFlow: React.FC<CaptureFlowProps> = ({
  mode = 'challenge',
  waypointId,
  challengeId,
  prompt,
  rubric,
  session,
  verification,
  playerLocation,
  onWatchVerdict,
  onClose
}) => {
  const isRoadblock = mode === 'roadblock';
  const [stage, setStage] = useState<CaptureStage>('brief');

  const idempotencyKeyRef = useRef(generateIdempotencyKey());
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [frame, setFrame] = useState<CapturedFrame | null>(null);
  const [opening, setOpening] = useState(false);

  /** Null until upload starts; non-null indicates percentage progress. */
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [submissionId, setSubmissionId] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [waited, setWaited] = useState(0);

  const [verdict, setVerdict] = useState<{ outcome: 'pass' | 'fail'; rationale: string } | null>(null);

  /* Revoke object URL when replaced or unmounted to prevent memory leaks. */
  useEffect(() => {
    const url = frame?.objectUrl;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [frame]);

  const acceptFrame = useCallback((next: CapturedFrame) => {
    setFrame(next);
    setSubmitError(null);
    setStage('review');
  }, []);

  const handleFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset so picking the same file twice still fires a change event.
    e.target.value = '';
    setOpening(false);
    if (!file) return;
    try {
      acceptFrame(await frameFromFile(file));
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'That photo could not be read. Try taking it again.');
    }
  };

  const openCamera = () => {
    setOpening(true);
    fileInputRef.current?.click();
  };

  /* Reset opening state when window regains focus if camera was cancelled. */
  useEffect(() => {
    if (!opening) return;
    const settle = () => window.setTimeout(() => setOpening(false), 400);
    window.addEventListener('focus', settle);
    return () => window.removeEventListener('focus', settle);
  }, [opening]);

  const uploadCancelledRef = useRef(false);
  const uploadAbortRef = useRef<AbortController | null>(null);

  /* Abandons an in-flight upload so it stops consuming the uplink. */
  const cancelUpload = useCallback(() => {
    uploadCancelledRef.current = true;
    uploadAbortRef.current?.abort();
    uploadAbortRef.current = null;
  }, []);

  /* Cancel in-flight upload on unmount. */
  useEffect(() => {
    return () => cancelUpload();
  }, [cancelUpload]);

  const handleRetake = () => {
    cancelUpload();
    setFrame(null);
    // Generate a new idempotency key for retakes to avoid cached responses.
    idempotencyKeyRef.current = generateIdempotencyKey();
    setSubmissionId(null);
    setVerdict(null);
    setSubmitError(null);
    setUploadProgress(null);
    setWaited(0);
    setStage('brief');
  };

  const handleSubmit = async () => {
    if (!frame) return;
    if (!playerLocation) {
      setSubmitError('No GPS fix yet — step into the open so your phone can find satellites, then submit.');
      setUploadProgress(null);
      setStage('review');
      return;
    }

    // Capture location snapshot at submission time so GPS jitter does not abort the in-flight upload.
    const submissionLocation = playerLocation;
    const controller = new AbortController();
    uploadAbortRef.current = controller;
    uploadCancelledRef.current = false;
    setSubmitError(null);
    setUploadProgress(null);
    setStage('uploading');

    try {
      const { upload_url, blob_ref } = await presignUpload(session.gameId, {
        team_token: session.teamToken,
        content_type: 'image/jpeg'
      });
      if (uploadCancelledRef.current) return;

      await uploadToPresignedUrl(
        upload_url,
        frame.blob,
        'image/jpeg',
        (pct) => {
          if (!uploadCancelledRef.current) setUploadProgress(pct);
        },
        controller.signal
      );
      if (uploadCancelledRef.current) return;

      const res = isRoadblock
        ? await clearRoadblock(session.gameId, {
          road_id: waypointId,
          team_token: session.teamToken,
          blob_ref,
          lat: submissionLocation.lat,
          lon: submissionLocation.lon,
          accuracy_m: submissionLocation.accuracy,
          client_captured_at: frame.capturedAt,
          idempotency_key: idempotencyKeyRef.current
        })
        : await submitChallengeEvidence(session.gameId, {
          waypoint_id: waypointId,
          road_id: waypointId,
          challenge_id: challengeId || waypointId,
          team_token: session.teamToken,
          blob_ref,
          lat: submissionLocation.lat,
          lon: submissionLocation.lon,
          accuracy_m: submissionLocation.accuracy,
          client_captured_at: frame.capturedAt,
          idempotency_key: idempotencyKeyRef.current
        });
      if (uploadCancelledRef.current) return;

      setSubmissionId(res.submission_id);
      if (res.status === 'pass') {
        setVerdict({ outcome: 'pass', rationale: TRUST_RATIONALE });
        setStage('result');
      } else {
        setStage('pending');
      }
    } catch (err) {
      if (uploadCancelledRef.current) return;
      if (!navigator.onLine && !isRoadblock) {
        enqueueAction({
          idempotencyKey: idempotencyKeyRef.current,
          type: 'capture',
          timestamp: new Date().toISOString(),
          payload: {
            gameId: session.gameId,
            waypointId: waypointId,
            challengeId: challengeId || waypointId,
            photo: frame.blob,
            contentType: 'image/jpeg',
            lat: submissionLocation.lat,
            lon: submissionLocation.lon,
            accuracyM: submissionLocation.accuracy,
            clientCapturedAt: frame.capturedAt
          }
        }).finally(() => {
          if (!uploadCancelledRef.current) setStage('queued');
        });
      } else {
        setSubmitError(err instanceof ApiError ? err.message : 'Upload failed — check your signal and try again.');
        setUploadProgress(null);
        // Return to review stage on network failure.
        setStage('review');
      }
    }
  };

  useEffect(() => {
    if (stage !== 'pending' || !submissionId) return;

    const checkVerdict = (state: ReturnType<typeof projectionStore.getState>): boolean => {
      const sub = state.submissions?.[submissionId];
      if (sub && (sub.status === 'pass' || sub.status === 'fail')) {
        setVerdict({
          outcome: sub.status,
          rationale: sub.rationale || (sub.status === 'pass' ? 'Graded successfully.' : 'Graded unsuccessfully.')
        });
        setStage('result');
        return true;
      }

      return false;
    };

    // Check current state immediately before subscribing.
    if (checkVerdict(projectionStore.getState())) return;

    const unsubscribe = projectionStore.subscribe((state) => {
      checkVerdict(state);
    });

    return unsubscribe;
  }, [stage, submissionId]);

  /* Track elapsed seconds waiting for grading verdict. */
  useEffect(() => {
    if (stage !== 'pending') return;
    setWaited(0);
    const started = Date.now();
    const id = window.setInterval(() => setWaited(Math.round((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(id);
  }, [stage]);

  /** Confirm discard before dismissing if an upload is in progress. */
  const handleDismiss = () => {
    if (stage === 'uploading') {
      setConfirmDiscard(true);
      return;
    }
    if (stage === 'pending' && submissionId) {
      onWatchVerdict?.(submissionId);
    }
    onClose();
  };

  const handleDiscard = () => {
    cancelUpload();
    onClose();
  };

  const mustShow = rubric?.must_show?.filter(Boolean) ?? [];
  const failsIf = rubric?.fails_if?.filter(Boolean) ?? [];
  const latitude = rubric?.acceptable_ambiguity;

  /** Stages that render as full-screen sheets. */
  const isSheet = stage === 'brief' || stage === 'review';

  return (
    <Dialog
      open
      title={isRoadblock ? 'ROADBLOCK CLEARANCE' : 'WAYPOINT VERIFICATION'}
      onClose={handleDismiss}
      className={isSheet ? 'dialog--capture' : ''}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFilePicked}
        hidden
      />

      {stage === 'brief' && (
        <div className="capture capture--sheet">
          <div className="capture__scroll">
            <div className="capture__challenge">
              <p className="capture__challenge-prompt">{prompt}</p>
            </div>

            <section className="capture__counts" aria-labelledby="capture-counts-title">
              <div className="capture__counts-head">
                <h3 className="capture__counts-title t-announce fs-7" id="capture-counts-title">
                  What counts
                </h3>
                <p className="capture__counts-lede">
                  {verification === 'trust'
                    ? 'Nothing is checked against these.'
                    : verification === 'host'
                      ? 'Your host grades your photo against these.'
                      : 'The referee grades your photo against these.'}
                </p>
              </div>

              {mustShow.length > 0 && (
                <div className="capture__criteria capture__criteria--must">
                  <span className="capture__criteria-label">Must show</span>
                  <ul>
                    {mustShow.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}

              {failsIf.length > 0 && (
                <div className="capture__criteria capture__criteria--fails">
                  <span className="capture__criteria-label">Rejected if</span>
                  <ul>
                    {failsIf.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}

              {latitude && (
                <div className="capture__criteria capture__criteria--latitude">
                  <span className="capture__criteria-label">Close enough</span>
                  <p>{latitude}</p>
                </div>
              )}

              {mustShow.length === 0 && failsIf.length === 0 && !latitude && (
                <div className="capture__criteria">
                  <span className="capture__criteria-label">No extra criteria</span>
                  <p>Shoot the challenge above, and make it obvious in one frame.</p>
                </div>
              )}
            </section>
          </div>

          <div className="capture__bar">
            {submitError && (
              <Notice kind="stop" title="That did not work">
                {submitError}
              </Notice>
            )}
            {/* Keep button clickable while opening to prevent locking UI if focus events fail. */}
            <Button variant="primary" size="lg" onClick={openCamera}>
              {opening ? 'Opening camera…' : 'Take the photo'}
            </Button>
            <p className="capture__bar-hint">
              {verification === 'trust'
                ? "Opens your phone's camera. You get to check the shot before it is saved."
                : verification === 'host'
                  ? "Opens your phone's camera. You get to check the shot before it goes to your host."
                  : "Opens your phone's camera. You get to check the shot before it goes to the referee."}
            </p>
            {import.meta.env.DEV && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  acceptFrame({
                    blob: new Blob(['mock'], { type: 'image/jpeg' }),
                    objectUrl: '',
                    width: 0,
                    height: 0,
                    capturedAt: new Date().toISOString()
                  })
                }
              >
                Use mock photo (dev only)
              </Button>
            )}
          </div>
        </div>
      )}

      {stage === 'review' && frame && (
        <div className="capture capture--sheet">
          <div className="capture__photo">
            {frame.objectUrl ? (
              <img src={frame.objectUrl} alt="The photo you are about to submit" />
            ) : (
              <p className="capture__placeholder">Mock photo — dev only</p>
            )}
          </div>

          <div className="capture__bar">
            {submitError && (
              <Notice kind="stop" title="That did not send">
                {submitError}
              </Notice>
            )}
            <div className="capture__actions">
              <Button variant="secondary" onClick={handleRetake}>
                Retake
              </Button>
              <Button variant="primary" onClick={handleSubmit}>
                {submitError ? 'Try again' : 'Submit'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {stage === 'uploading' && (
        <div className="capture">
          {confirmDiscard ? (
            <div className="capture__status" role="status">
              <Notice kind="warn" title="Discard this upload?">
                Your photo is still sending. Leaving now throws it away and the waypoint stays unproven.
              </Notice>
              <div className="capture__actions">
                <Button variant="secondary" onClick={handleDiscard}>
                  Discard
                </Button>
                <Button variant="primary" onClick={() => setConfirmDiscard(false)}>
                  Keep sending
                </Button>
              </div>
            </div>
          ) : (
            <div className="capture__status" role="status" aria-live="polite">
              <h3 className="t-announce fs-7">SENDING EVIDENCE</h3>
              <p>Your photo is going straight to the referee&apos;s store.</p>
              <div
                className={`capture__progress${uploadProgress === null ? ' capture__progress--waiting' : ''}`}
                role="progressbar"
                aria-label="Uploading photo"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={uploadProgress ?? undefined}
              >
                <div className="capture__progress-fill" style={{ width: uploadProgress === null ? undefined : `${uploadProgress}%` }} />
              </div>
              <span className="capture__pct">{uploadProgress === null ? 'Starting' : `${uploadProgress}%`}</span>
            </div>
          )}
        </div>
      )}

      {stage === 'queued' && (
        <div className="capture">
          <div className="capture__status" role="status" aria-live="polite">
            <h3 className="t-announce fs-7">SAVED FOR LATER</h3>
            <p>
              No signal out here. Your photo is stored on this phone and sends itself the moment coverage
              comes back — keep racing.
            </p>
            <Button variant="primary" onClick={onClose}>
              Back to the race
            </Button>
          </div>
        </div>
      )}

      {stage === 'pending' && (
        <div className="capture">
          <div className="capture__status" role="status" aria-live="polite">
            <Chip kind="live">{verification === 'host' ? 'WITH YOUR HOST' : 'EVALUATING EVIDENCE'}</Chip>
            <h3 className="t-announce fs-7">
              {verification === 'host' ? 'YOUR HOST IS LOOKING' : 'THE REFEREE IS LOOKING'}
            </h3>
            <span className="capture__clock">
              {String(Math.floor(waited / 60)).padStart(2, '0')}:{String(waited % 60).padStart(2, '0')}
            </span>
            {/* Host grading can be asynchronous; allow players to dismiss and continue racing. */}
            <p>
              {verification === 'host'
                ? 'A person is grading this one, so it takes as long as it takes. Go and keep racing — we will tell you the moment it lands.'
                : waited < PATIENCE_SECONDS
                  ? 'Checking your photo against what this waypoint asks for.'
                  : 'This one is taking a while. You do not have to wait here — we will tell you the moment it lands.'}
            </p>
            {(verification === 'host' || waited >= PATIENCE_SECONDS) && (
              <Button variant="primary" onClick={handleDismiss}>
                Keep racing
              </Button>
            )}
          </div>
        </div>
      )}

      {stage === 'result' && verdict && (
        <div className="capture">
          <div className="capture__verdict" role="alert">
            <Callout kind={verdict.outcome === 'pass' ? 'pass' : 'curse'}>
              <div className="callout__kind">{verdict.outcome === 'pass' ? 'Cleared' : 'Not accepted'}</div>
              <h3 className="callout__title fs-8">
                {verdict.outcome === 'pass' ? 'Verdict: approved' : 'Verdict: rejected'}
              </h3>
            </Callout>

            <div className="capture__note">
              <span className="t-label">
                {verification === 'host' ? "Host's note" : verification === 'trust' ? 'Note' : "Referee's note"}
              </span>
              <p className="capture__rationale">{verdict.rationale}</p>
            </div>

            <div className="capture__actions">
              {verdict.outcome === 'fail' ? (
                <>
                  <Button variant="secondary" onClick={onClose}>
                    Back to the race
                  </Button>
                  <Button variant="primary" onClick={handleRetake}>
                    Retake photo
                  </Button>
                </>
              ) : (
                <Button variant="primary" onClick={onClose}>
                  Back to the race
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </Dialog>
  );
};
export default CaptureFlow;
