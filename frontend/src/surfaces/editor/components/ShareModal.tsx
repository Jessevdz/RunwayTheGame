import React, { useState } from 'react';
import { Dialog, Button, Input, Notice, Badge } from '@ds';
import { useCopyFeedback } from '../../../core/hooks/useCopyFeedback';

interface ShareModalProps {
  mapId: string;
  mapName: string;
  editToken: string | null;
  /** Listed in the public gallery right now. */
  isListed: boolean;
  /** Unsaved edits exist. Publishing them would list a map that differs from
   *  what this designer is looking at. */
  isDirty: boolean;
  /** Blocking validation errors. A broken map should not reach the gallery. */
  errorCount: number;
  busy: boolean;
  error: string | null;
  onSetListed: (next: boolean) => void;
  onClose: () => void;
}

/** Modal for managing board sharing links and public gallery publishing. */
export const ShareModal: React.FC<ShareModalProps> = ({
  mapId,
  mapName,
  editToken,
  isListed,
  isDirty,
  errorCount,
  busy,
  error,
  onSetListed,
  onClose
}) => {
  const [copiedView, copyView] = useCopyFeedback();
  const [copiedEdit, copyEdit] = useCopyFeedback();
  const [confirmingPublish, setConfirmingPublish] = useState(false);

  const viewUrl = `${window.location.origin}/design/${mapId}`;
  const editUrl = editToken ? `${window.location.origin}/design/${mapId}#key=${editToken}` : null;

  // A device without the token is a viewer. It can copy the view link; it
  // cannot decide what the rest of the world sees.
  const canDecideListing = !!editToken;
  const publishBlockedReason = !canDecideListing
    ? 'Only the device that created this map can publish it.'
    : errorCount > 0
      ? `Fix ${errorCount} blocking ${errorCount === 1 ? 'error' : 'errors'} before publishing — the gallery is for maps people can actually race.`
      : isDirty
        ? 'Save your changes first, so the gallery shows the map you are looking at.'
        : null;

  return (
    <Dialog open title="SHARE & PUBLISH" onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-5)' }}>
        {/* Gallery — the public/private decision, first, because it is the one
            thing in this dialog that changes what other people can see. */}
        <section>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 'var(--sp-3)',
              marginBottom: 'var(--sp-2)'
            }}
          >
            <span className="t-label fs-label">PUBLIC GALLERY</span>
            <Badge tone={isListed ? 'moss' : 'rust'}>{isListed ? 'PUBLISHED' : 'PRIVATE'}</Badge>
          </div>

          <p className="fs-4" style={{ margin: '0 0 var(--sp-3)', color: 'var(--ink-muted)' }}>
            {isListed
              ? 'This map is listed in the public gallery. Anyone can find it, race it, and fork their own copy.'
              : 'This map is saved to this device only. Nobody else can find it unless you publish it or hand them a link.'}
          </p>

          {error && (
            <Notice kind="stop" style={{ marginBottom: 'var(--sp-3)' }}>
              {error}
            </Notice>
          )}

          {isListed ? (
            <Button variant="secondary" size="sm" disabled={busy || !canDecideListing} onClick={() => onSetListed(false)}>
              {busy ? 'Removing…' : 'Remove from gallery'}
            </Button>
          ) : publishBlockedReason ? (
            <Notice kind="info">{publishBlockedReason}</Notice>
          ) : confirmingPublish ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
              <span className="fs-4" style={{ color: 'var(--ink-strong)' }}>
                Publish “{mapName || 'Untitled Map'}” to the public gallery?
              </span>
              <Button
                variant="primary"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setConfirmingPublish(false);
                  onSetListed(true);
                }}
              >
                {busy ? 'Publishing…' : 'Yes, publish'}
              </Button>
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirmingPublish(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button variant="primary" size="sm" onClick={() => setConfirmingPublish(true)}>
              Publish to gallery
            </Button>
          )}

          {isListed && (
            <p className="fs-3" style={{ margin: 'var(--sp-2) 0 0', color: 'var(--ink-muted)' }}>
              Removing it hides it from the gallery. The map itself stays on this device, and you can publish it again
              whenever you like.
            </p>
          )}
        </section>

        {/* Links — sharing a map with named people, which works whether or not
            the map is in the gallery. */}
        <section>
          <span className="t-label fs-label">LINKS</span>

          <div style={{ marginTop: 'var(--sp-2)' }}>
            <Input
              label="Public View Link (Read-Only)"
              value={viewUrl}
              readOnly
              hint="Anyone with this link can view the map and fork their own copy — gallery or not."
            />
            <div style={{ marginTop: 'var(--sp-2)', display: 'flex', justifyContent: 'flex-end' }}>
              <Button variant="secondary" size="sm" onClick={() => copyView(viewUrl)}>
                {copiedView ? 'Copied! ✓' : 'Copy'}
              </Button>
            </div>
          </div>

          {editUrl && (
            <div style={{ marginTop: 'var(--sp-4)' }}>
              <Input
                label="🔑 Edit Link (Grants Edit Access)"
                value={editUrl}
                readOnly
                hint="Carries the edit key: whoever opens it can edit this map, publish it, and take it down. Share only with trusted co-designers."
              />
              <div style={{ marginTop: 'var(--sp-2)', display: 'flex', justifyContent: 'flex-end' }}>
                <Button variant="primary" size="sm" onClick={() => copyEdit(editUrl)}>
                  {copiedEdit ? 'Copied! ✓' : 'Copy Key Link'}
                </Button>
              </div>
            </div>
          )}
        </section>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </Dialog>
  );
};
