import React from 'react';
import { type GameState, type RaceStanding } from '../../../core/projection/projectionStore';
import { slotColor, getNeutralColor } from '../../../core/team/palette';
import { Board, IconCoin, type BoardColumn } from '@ds';
import { ordinal } from '../consoleFormat';

interface StandingsBoardProps {
  gameState: GameState;
  /** The row that gets the "You" flag. */
  teamId: string;
  coinRush: boolean;
  /** Waypoints on the board, the denominator of the CP column. */
  total: number;
}

type StandingRow = RaceStanding & { rank: number };

/** Flight-board standings table displaying live race rankings. */
export const StandingsBoard: React.FC<StandingsBoardProps> = ({ gameState, teamId, coinRush, total }) => {
  const columns: BoardColumn<StandingRow>[] = [
    {
      key: 'rank',
      header: '#',
      numeric: true,
      render: (row) => row.rank
    },
    {
      key: 'team',
      header: 'Team',
      who: true,
      render: (row) => {
        const info = gameState.teams[row.teamId];
        const color = info ? slotColor(info.slotIndex).color : getNeutralColor().color;
        return (
          <>
            <span className="player-board__dot" style={{ backgroundColor: color }} />
            <span className="player-board__name">{row.teamName}</span>
            {/* Your own row, said in a word. Rank 1 already marks the
                leader, so Board's LEADING flag would only repeat it. */}
            {row.teamId === teamId && <span className="player-board__you">You</span>}
          </>
        );
      }
    },
    ...(coinRush
      ? [
          {
            key: 'coins',
            header: 'Coins',
            numeric: true,
            render: (row: StandingRow) => <><IconCoin /> {row.coins}</>
          },
          {
            key: 'placed',
            header: 'Placed',
            numeric: true,
            render: (row: StandingRow) => (row.finishRank ? ordinal(row.finishRank) : '—')
          }
        ]
      : []),
    {
      key: 'cp',
      header: 'CP',
      numeric: true,
      render: (row) => `${row.waypointsReached}/${total}`
    },
    {
      key: 'togo',
      header: 'To go',
      numeric: true,
      render: (row) => `${(row.distanceToFinishM / 1000).toFixed(1)} km`
    }
  ];

  return (
    <Board
      className="player-board"
      rows={gameState.standings.map((row, index) => ({ ...row, rank: index + 1 }))}
      rowKey={(row) => row.teamId}
      columns={columns}
    />
  );
};
