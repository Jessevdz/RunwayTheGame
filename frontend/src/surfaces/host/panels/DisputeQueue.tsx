import React, { useMemo, useState } from 'react';
import type { GameState } from '../../../core/projection/projectionStore';
import { resolveDispute } from '../../../core/api/client';
import { Plate, Card, Button, Badge, Empty, Chip } from '@ds';
import type { ToastMessage } from '../HostToolsPanel';

interface DisputeQueueProps {
  gameId: string;
  hostToken: string;
  gameState: GameState;
  onToast: (text: string, tone?: ToastMessage['tone']) => void;
}

export const DisputeQueue: React.FC<DisputeQueueProps> = ({ gameId, hostToken, gameState, onToast }) => {
  const [resolving, setResolving] = useState<string | null>(null);

  const pending = useMemo(
    () => Object.values(gameState.disputes).filter((d) => d.status === 'pending'),
    [gameState.disputes]
  );
  const resolved = useMemo(
    () => Object.values(gameState.disputes).filter((d) => d.status !== 'pending'),
    [gameState.disputes]
  );

  /** A waypoint id is a uuid to the host too. Name it where there is a name. */
  const waypointName = (id: string): string =>
    gameState.waypoints.find((w) => w.id === id)?.name || id;

  const handleResolve = async (verdictId: string, outcome: 'upheld' | 'overturned') => {
    setResolving(verdictId);
    try {
      await resolveDispute(gameId, hostToken, verdictId, outcome);
      onToast(outcome === 'upheld' ? 'Dispute upheld — the pass stands.' : 'Dispute dismissed — the verdict stands.', 'moss');
    } catch (err: any) {
      onToast(err.message || 'Failed to resolve the dispute', 'crimson');
    } finally {
      setResolving(null);
    }
  };

  if (pending.length === 0 && resolved.length === 0) {
    return <Empty icon="⚖️" title="No disputes filed" description="Disputes raised by players will appear here for review." />;
  }

  return (
    <div className="dispute-queue">
      {pending.length === 0 ? (
        <Empty icon="✅" title="No pending disputes" description="Everything raised so far has been resolved." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
          {pending.map((d) => {
            const submission = Object.values(gameState.submissions).find((s) => s.submissionId === d.verdictId);
            const teamName = gameState.teams[d.byTeamId]?.name || d.byTeamId;
            return (
              <Plate key={d.verdictId} className="dispute-card">
                <div className="dispute-card__header">
                  <span className="fs-6" style={{ fontWeight: 600 }}>{teamName}</span>
                  {submission && <Badge tone={submission.status === 'pass' ? 'moss' : submission.status === 'fail' ? 'crimson' : 'gold'}>{submission.status}</Badge>}
                  {submission?.waypointId && (
                  <span className="fs-3" style={{ color: 'var(--ink-muted)' }}>{waypointName(submission.waypointId)}</span>
                )}
                </div>

                <p className="fs-5" style={{ margin: 0 }}>
                  <strong>Objection:</strong> {d.objection}
                </p>

                {submission && (
                  <div className="dispute-card__evidence">
                    <div className="fs-3" style={{ color: 'var(--ink-muted)' }}>Evidence</div>
                    <div className="fs-4" style={{ fontFamily: 'var(--font-data)' }}>{submission.blobRef}</div>
                    <p className="fs-4" style={{ marginTop: 'var(--sp-2)' }}>
                      <strong>Verdict rationale:</strong> {submission.rationale} ({Math.round(submission.confidence * 100)}% confidence)
                    </p>
                  </div>
                )}

                <div className="dispute-card__actions">
                  <Button variant="primary" disabled={resolving === d.verdictId} onClick={() => handleResolve(d.verdictId, 'upheld')}>
                    Uphold
                  </Button>
                  <Button variant="secondary" disabled={resolving === d.verdictId} onClick={() => handleResolve(d.verdictId, 'overturned')}>
                    Dismiss
                  </Button>
                </div>
              </Plate>
            );
          })}
        </div>
      )}

      {resolved.length > 0 && (
        <Card className="card--pad" style={{ marginTop: 'var(--sp-5)' }}>
          <h3 className="t-announce fs-6" style={{ margin: '0 0 var(--sp-3)', color: 'var(--ink-strong)' }}>
            HISTORY
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
            {resolved.map((d) => (
              <div key={d.verdictId} className="fs-4" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>{gameState.teams[d.byTeamId]?.name || d.byTeamId}: {d.objection}</span>
                <Chip kind={d.status === 'upheld' ? 'power' : 'veto'}>{d.status}</Chip>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
};
export default DisputeQueue;
