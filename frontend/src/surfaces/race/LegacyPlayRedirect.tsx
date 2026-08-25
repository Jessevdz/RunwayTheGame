import React, { useMemo } from 'react';
import { Navigate } from 'react-router-dom';
import { parseJoinInput } from '../../core/game/joinTarget';
import { saveTeamSession, loadTeamSession } from '../../core/game/teamSession';
import { rememberRace, lobbyPath } from '../../core/game/raceSession';

/** Legacy route redirect component for legacy `/play` URLs. */
export const LegacyPlayRedirect: React.FC = () => {
  const target = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const parsed = parseJoinInput(window.location.pathname + window.location.search);
    if (!parsed || parsed.kind !== 'link') return null;

    if (parsed.teamToken && parsed.teamId && !loadTeamSession(parsed.gameId)) {
      saveTeamSession({
        gameId: parsed.gameId,
        teamId: parsed.teamId,
        teamToken: parsed.teamToken,
        teamName: parsed.teamName || 'Teammate',
        slotIndex: parsed.slotIndex ?? 0,
        homeWaypointId: null,
      });
    }
    rememberRace({ gameId: parsed.gameId });

    const search = new URLSearchParams();
    // The API override has to survive the hop or the joiner silently resolves a
    // different backend than the host is running.
    const api = params.get('api');
    if (api) search.set('api', api);

    const hasTeam = !!loadTeamSession(parsed.gameId);
    const path = hasTeam ? `/race/${parsed.gameId}` : lobbyPath(parsed.gameId);
    if (hasTeam) search.set('view', 'play');
    const query = search.toString();
    return query ? `${path}?${query}` : path;
  }, []);

  return <Navigate to={target || '/'} replace />;
};

export default LegacyPlayRedirect;
