import React from 'react';
import { Navigate, useParams } from 'react-router-dom';

/** Legacy route redirect component forwarding `/host/:gameId/live` to `/race/:gameId?view=host`. */
export const LegacyHostConsoleRedirect: React.FC = () => {
  const { gameId } = useParams<{ gameId: string }>();
  return <Navigate to={gameId ? `/race/${gameId}?view=host` : '/races'} replace />;
};

export default LegacyHostConsoleRedirect;
