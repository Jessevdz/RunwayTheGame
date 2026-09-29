import React, { useState } from 'react';
import { Dialog, Button, Input, Notice, Badge, Icon } from '@ds';
import { useCopyFeedback } from '../../../core/hooks/useCopyFeedback';
import { analytics } from '../../../core/analytics/analyticsClient';

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

  /** Records a copy only when the clipboard actually took it. */
  const copyLink = async (link: string, url: string, copy: (text: string) => Promise<boolean>) => {
    if (await copy(url)) analytics.track('board.share_copied', { link });
  };
  const [confirmingPublish, setConfirmingPublish] = useState(false);

  const viewUrl = `${window.location.origin}/design/${mapId}`;
  const editUrl = editToken ? `${window.location.origin}/design/${mapId}#key=${editToken}` : null;

  // A device without the token is a viewer. It can copy the view link; it
  // cannot decide what the rest of the world sees.
  const canDecideListing = !!editToken;
  const publishBlockedReason = !canDecideListing
    ? 'Only the device that created this map can publish it.'
    : errorCount > 0
      ? `Fix ${errorCount} blocking ${errorCount === 1 ? 'error' : 'errors'} before publishing.`
      : isDirty
        ? 'Save your changes first.'
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
              ? 'Anyone can find, race, and fork it.'
              : 'Only you can see it unless you publish it or share a link.'}
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
              hint="Anyone with this link can view and fork the map."
            />
            <div style={{ marginTop: 'var(--sp-2)', display: 'flex', justifyContent: 'flex-end' }}>
              <Button variant="secondary" size="sm" onClick={() => void copyLink('view', viewUrl, copyView)}>
                {copiedView ? <>Copied! <Icon name="check" /></> : 'Copy'}
              </Button>
            </div>
          </div>

          {editUrl && (
            <div style={{ marginTop: 'var(--sp-4)' }}>
              <Input
                label="Edit Link (Grants Edit Access)"
                value={editUrl}
                readOnly
                hint="Grants full edit access, including publishing and removal. Share only with co-designers you trust."
              />
              <div style={{ marginTop: 'var(--sp-2)', display: 'flex', justifyContent: 'flex-end' }}>
                <Button variant="primary" size="sm" onClick={() => void copyLink('edit', editUrl, copyEdit)}>
                  {copiedEdit ? <>Copied! <Icon name="check" /></> : 'Copy Key Link'}
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
