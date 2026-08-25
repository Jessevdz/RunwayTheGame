import React, { useState } from 'react';
import { getTeamPalette } from '../../core/team/palette';
import { useJoinTeam } from '../../core/game/useJoinTeam';
import type { TeamSession } from '../../core/game/teamSession';
import { Input, Notice } from '@ds';

interface TeamPickerProps {
  gameId: string | undefined;
  /** Roster from the projection, used to grey out colours already claimed. */
  teams: { [teamId: string]: { name: string; slotIndex: number } };
  boardName?: string;
  /** Display name of player creating or joining squad. */
  displayName?: string;
  onJoined: (session: TeamSession) => void;
}

/** Team name and color selection form component. */
export const TeamPicker: React.FC<TeamPickerProps> = ({ gameId, teams, boardName, displayName, onJoined }) => {
  const [teamName, setTeamName] = useState('');
  const { joinNewTeam, busy, error } = useJoinTeam(gameId, boardName);

  // Disable color slots already claimed by existing teams.
  const takenSlots = new Set(Object.values(teams).map((t) => t.slotIndex));
  const palette = getTeamPalette();

  const handlePick = async (slotIndex: number) => {
    const session = await joinNewTeam(teamName, slotIndex, displayName);
    if (session) onJoined(session);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
      {error && <Notice kind="stop" title="Couldn't join">{error}</Notice>}

      <Input label="Team name" value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="e.g. Red Dragons" />
      <p className="fs-5" style={{ color: 'var(--ink-muted)', margin: 0 }}>
        Pick an available team color slot to establish your team:
      </p>

      {/* A <Button> tinted with an inline background is a button pretending to
          be a swatch. These are swatches — see .team-pick. */}
      <div className="pane-list" style={{ gridTemplateColumns: '1fr 1fr' }}>
        {palette.map((slot, slotIndex) => {
          const taken = takenSlots.has(slotIndex);
          return (
            <button
              key={slotIndex}
              type="button"
              className="team-pick"
              style={{ background: slot.bg, borderColor: slot.color }}
              disabled={busy || taken || !teamName.trim()}
              onClick={() => handlePick(slotIndex)}
            >
              <span className="game-pane__dot" style={{ backgroundColor: slot.color }} />
              <span>{slot.label}</span>
              {taken && <span className="team-pick__hint">Taken</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
};
