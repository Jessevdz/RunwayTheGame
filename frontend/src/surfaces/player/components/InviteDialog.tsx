import React from 'react';
import { Button, Dialog, Icon } from '@ds';
import { type TeamSession } from '../../../core/game/teamSession';
import { lobbyPath } from '../../../core/game/raceSession';
import { shareLink } from '../../../core/share';
import { useCopyFeedback } from '../../../core/hooks/useCopyFeedback';

/** Team invitation dialog displaying join code and share link options. */
export const InviteDialog: React.FC<{ session: TeamSession; onClose: () => void }> = ({
  session,
  onClose
}) => {
  const [copiedInvite, copyInvite] = useCopyFeedback(3000);
  const [copiedTeamCode, copyTeamCode] = useCopyFeedback(3000);

  const handleCopyInviteLink = async () => {
    const url = new URL(lobbyPath(session.gameId), window.location.origin);
    if (session.teamId && session.joinCode) {
      url.searchParams.set('teamId', session.teamId);
      url.searchParams.set('teamCode', session.joinCode);
    }
    if ((await shareLink(url.toString(), { title: 'Join my squad on Runway' })) === 'shared') return;
    await copyInvite(url.toString());
  };

  const handleCopyTeamCode = async () => {
    if (!session.joinCode) return;
    await copyTeamCode(session.joinCode);
  };

  return (
    <Dialog open title="Invite Teammates" onClose={onClose}>
      {session.joinCode ? (
        <div className="player-code">
          <div className="player-code__row">
            <span className="player-code__label">Team join code</span>
            <span className="player-code__value">{session.joinCode}</span>
          </div>
          <p className="player-more__note">
            Teammates share your coins, inventory, and progress.
          </p>
          <div className="player-code__actions">
            <Button variant="secondary" size="sm" icon={<Icon name={copiedTeamCode ? 'check-circle' : 'copy'} />} onClick={handleCopyTeamCode}>
              {copiedTeamCode ? 'Code Copied' : 'Copy Code'}
            </Button>
            <Button variant="secondary" size="sm" icon={<Icon name={copiedInvite ? 'check-circle' : 'link'} />} onClick={handleCopyInviteLink}>
              {copiedInvite ? 'Link Copied' : 'Copy Teammate Link'}
            </Button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
          <p className="player-more__note">
            Teammates share your coins, inventory, and progress.
          </p>
          <Button variant="secondary" size="sm" icon={<Icon name={copiedInvite ? 'check-circle' : 'link'} />} onClick={handleCopyInviteLink}>
            {copiedInvite ? 'Link Copied' : 'Copy Teammate Link'}
          </Button>
        </div>
      )}
    </Dialog>
  );
};
