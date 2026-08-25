import React from 'react';
import { Dialog, Button } from '@ds';

export type PendingDeleteTarget =
  | {
      type: 'waypoint';
      id: string;
      name: string;
      connectedRoadCount: number;
    }
  | {
      type: 'road';
      id: string;
      waypointAName: string;
      waypointBName: string;
    };

interface DeleteConfirmModalProps {
  target: PendingDeleteTarget;
  onConfirm: () => void;
  onCancel: () => void;
}

export const DeleteConfirmModal: React.FC<DeleteConfirmModalProps> = ({
  target,
  onConfirm,
  onCancel
}) => {
  const isWaypoint = target.type === 'waypoint';
  const title = isWaypoint ? 'DELETE WAYPOINT' : 'REMOVE ROAD SECTION';

  return (
    <Dialog open title={`🗑️ ${title}`} onClose={onCancel}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
        {isWaypoint ? (
          <div>
            <p style={{ margin: '0 0 var(--sp-2) 0', fontSize: '1rem', fontWeight: 600 }}>
              Are you sure you want to delete <strong>{target.name}</strong>?
            </p>
            {target.connectedRoadCount > 0 ? (
              <p style={{ margin: 0, color: 'var(--ink-muted)', fontSize: '0.9rem' }}>
                This will also remove <strong>{target.connectedRoadCount}</strong> connected road section(s). This action cannot be undone.
              </p>
            ) : (
              <p style={{ margin: 0, color: 'var(--ink-muted)', fontSize: '0.9rem' }}>
                This action cannot be undone.
              </p>
            )}
          </div>
        ) : (
          <div>
            <p style={{ margin: '0 0 var(--sp-2) 0', fontSize: '1rem', fontWeight: 600 }}>
              Are you sure you want to remove the road section between <strong>{target.waypointAName}</strong> and <strong>{target.waypointBName}</strong>?
            </p>
            <p style={{ margin: 0, color: 'var(--ink-muted)', fontSize: '0.9rem' }}>
              This action cannot be undone.
            </p>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--sp-2)', marginTop: 'var(--sp-4)' }}>
          <Button variant="secondary" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={onConfirm}
            style={{ background: 'var(--red)', borderColor: 'var(--red)' }}
          >
            Confirm Delete
          </Button>
        </div>
      </div>
    </Dialog>
  );
};
