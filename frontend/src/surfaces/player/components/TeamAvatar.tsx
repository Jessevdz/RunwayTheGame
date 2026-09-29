import React from 'react';
import { teamInitials, teamSlot } from '../../../core/player/teamIdentity';
import '../team-avatar.css';

interface TeamAvatarProps {
  teamId: string;
  name: string;
  /** Known team slots, so the colour matches the map dot. */
  teams?: Record<string, { slotIndex: number }>;
  size?: 'sm' | 'md';
}

/** A round chip in the team's colour carrying its initials. */
export const TeamAvatar: React.FC<TeamAvatarProps> = ({ teamId, name, teams, size = 'md' }) => {
  const slot = teamSlot(teamId, teams);
  return (
    <span className={`team-avatar team-avatar--${size}`} data-slot={slot} aria-hidden="true">
      {teamInitials(name)}
    </span>
  );
};
