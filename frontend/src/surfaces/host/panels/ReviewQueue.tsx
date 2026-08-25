import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GameState } from '../../../core/projection/projectionStore';
import { listPendingReview, submitHostVerdict, ApiError, type PendingReviewItem } from '../../../core/api/client';
import { Plate, Button, Badge, Empty, Notice, Textarea } from '@ds';
import type { ToastMessage } from '../HostToolsPanel';

interface ReviewQueueProps {
  gameId: string;
  hostToken: string;
  gameState: GameState;
  onToast: (text: string, tone?: ToastMessage['tone']) => void;
}

/** Evidence review queue panel for host verification. */
export const ReviewQueue: React.FC<ReviewQueueProps> = ({ gameId, hostToken, gameState, onToast }) => {
  const [items, setItems] = useState<PendingReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [grading, setGrading] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  // Count of pending reviews from game state.
  const pendingCount = useMemo(
    () => Object.values(gameState.submissions).filter((s) => s.status === 'pending').length,
    [gameState.submissions]
  );

  const loadedOnce = useRef(false);

  const fetchQueue = useCallback(
    async (showSpinner: boolean) => {
      if (showSpinner) setLoading(true);
      try {
        const res = await listPendingReview(gameId, hostToken);
        setItems(res.pending);
        setError(null);
      } catch (err: any) {
        setError(err.message || 'Failed to load the review queue');
      } finally {
        loadedOnce.current = true;
        setLoading(false);
      }
    },
    [gameId, hostToken]
  );

  useEffect(() => {
    void fetchQueue(!loadedOnce.current);
  }, [fetchQueue, pendingCount]);

  const grade = async (item: PendingReviewItem, verdict: 'pass' | 'fail') => {
    const rationale = (notes[item.submission_id] || '').trim();
    if (verdict === 'fail' && !rationale) {
      onToast('Say why it was rejected — the team sees this note.', 'gold');
      return;
    }

    setGrading(item.submission_id);
    try {
      await submitHostVerdict(gameId, hostToken, {
        submission_id: item.submission_id,
        verdict,
        rationale: rationale || 'Approved by the host.'
      });
      setItems((prev) => prev.filter((i) => i.submission_id !== item.submission_id));
      setNotes((prev) => {
        const next = { ...prev };
        delete next[item.submission_id];
        return next;
      });
      onToast(
        verdict === 'pass' ? `${item.team_name} cleared.` : `${item.team_name} rejected.`,
        verdict === 'pass' ? 'moss' : 'crimson'
      );
    } catch (err: any) {
      // 409 is the stale-queue case — somebody already graded it, possibly the
      // same host on another phone. Not an error worth alarming about; just
      // resync.
      if (err instanceof ApiError && err.status === 409) {
        onToast('That one was already graded.', 'neutral');
        void fetchQueue(false);
      } else {
        onToast(err.message || 'Failed to record that verdict', 'crimson');
      }
    } finally {
      setGrading(null);
    }
  };

  if (loading) {
    return <Empty icon="⏳" title="Loading the queue" description="Fetching what is waiting to be graded." />;
  }

  if (error) {
    return (
      <Notice kind="stop" title="The queue could not be loaded">
        {error}
        <div style={{ marginTop: 'var(--sp-3)' }}>
          <Button variant="secondary" onClick={() => void fetchQueue(true)}>
            Try again
          </Button>
        </div>
      </Notice>
    );
  }

  if (items.length === 0) {
    return (
      <Empty
        icon="📷"
        title="Nothing waiting"
        description="Photos appear here the moment a team submits one. You are the referee in this race — nothing is graded until you look at it."
      />
    );
  }

  return (
    <div className="review-queue">
      {items.map((item) => {
        // Resolves prompt text for challenge or roadblock submissions.
        const roadblockText = item.road_id ? gameState.roadblocks[item.road_id]?.challengeText : '';
        const prompt = item.prompt || roadblockText || 'No prompt recorded for this submission.';
        const mustShow = item.rubric?.must_show?.filter(Boolean) ?? [];
        const failsIf = item.rubric?.fails_if?.filter(Boolean) ?? [];
        const busy = grading === item.submission_id;

        return (
          <Plate key={item.submission_id} className="review-card">
            <div className="review-card__head">
              <span className="fs-6" style={{ fontWeight: 600 }}>
                {item.team_name || item.team_id}
              </span>
              <Badge tone={item.kind === 'roadblock' ? 'rust' : 'gold'}>
                {item.kind === 'roadblock' ? 'Roadblock' : 'Waypoint'}
              </Badge>
              <span className="t-data fs-2" style={{ color: 'var(--ink-muted)' }}>
                {new Date(item.submitted_at).toLocaleTimeString()}
              </span>
            </div>

            <div className="review-card__photo">
              {item.photo_url ? (
                <img src={item.photo_url} alt={`Evidence from ${item.team_name}`} loading="lazy" />
              ) : (
                <p className="review-card__photo-missing fs-4">
                  The photo could not be loaded. Check that this deployment has an object store configured.
                </p>
              )}
            </div>

            <div className="review-card__brief">
              <div>
                <span className="t-label fs-label">The challenge</span>
                <p className="review-card__prompt">{prompt}</p>
              </div>

              {mustShow.length > 0 && (
                <div className="review-card__criteria">
                  <span className="t-label fs-label">Must show</span>
                  <ul className="fs-4">
                    {mustShow.map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                </div>
              )}

              {failsIf.length > 0 && (
                <div className="review-card__criteria">
                  <span className="t-label fs-label">Rejected if</span>
                  <ul className="fs-4">
                    {failsIf.map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                </div>
              )}

              {item.rubric?.acceptable_ambiguity && (
                <div className="review-card__criteria">
                  <span className="t-label fs-label">Close enough</span>
                  <p className="fs-4" style={{ margin: 'var(--sp-1) 0 0' }}>
                    {item.rubric.acceptable_ambiguity}
                  </p>
                </div>
              )}

              {/* The server already refused anything outside the waypoint's
                  arrival radius, so this is context rather than a check to
                  redo. */}
              <div className="review-card__meta">
                {item.accuracy_m !== undefined && <span>±{Math.round(item.accuracy_m)}M GPS</span>}
                {item.client_captured_at && (
                  <span>SHOT {new Date(item.client_captured_at).toLocaleTimeString()}</span>
                )}
              </div>
            </div>

            <div className="review-card__actions">
              <Textarea
                label="Note to the team"
                placeholder={'What made it pass, or what was missing. Required to reject.'}
                rows={2}
                value={notes[item.submission_id] || ''}
                onChange={(e) => setNotes((prev) => ({ ...prev, [item.submission_id]: e.target.value }))}
              />
              <div className="review-card__buttons">
                <Button variant="primary" disabled={busy} onClick={() => void grade(item, 'pass')}>
                  {busy ? 'Recording…' : 'Approve'}
                </Button>
                <Button variant="secondary" disabled={busy} onClick={() => void grade(item, 'fail')}>
                  Reject
                </Button>
              </div>
            </div>
          </Plate>
        );
      })}
    </div>
  );
};

export default ReviewQueue;
