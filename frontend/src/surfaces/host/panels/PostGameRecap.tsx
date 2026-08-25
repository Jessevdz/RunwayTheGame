import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { isCoinRush, type GameState } from '../../../core/projection/projectionStore';
import { slotColor, getNeutralColor } from '../../../core/team/palette';
import { Hero, Sticker, Board, type BoardColumn, Card, Empty, Button, IconCoin } from '@ds';

interface PostGameRecapProps {
  gameState: GameState;
}

const MILESTONE_PATTERNS = [
  /^Game started/,
  /^Game ended/,
  /reached waypoint/,
  /cleared by team/,
  /^Dispute raised/,
  /^Dispute on .* resolved/,
  /^\[GM\]/,
  /used powerup/
];

function isMilestone(line: string): boolean {
  return MILESTONE_PATTERNS.some((p) => p.test(line));
}

function sumCoinDeltas(logs: string[]): { earned: number; spent: number } {
  let earned = 0;
  let spent = 0;
  const patterns = [/coins changed by (-?\d+)/, /\[GM\] Adjusted coins for team [^:]+: ([+-]?\d+)/];
  for (const line of logs) {
    for (const p of patterns) {
      const m = line.match(p);
      if (m) {
        const delta = parseInt(m[1], 10);
        if (delta > 0) earned += delta;
        else spent += Math.abs(delta);
        break;
      }
    }
  }
  return { earned, spent };
}

interface FinalStandingRow {
  teamId: string;
  teamName: string;
  waypointsReached: number;
  distanceToFinishM: number;
  coins: number;
  finishRank: number;
  finishBonus: number;
}

/** Formats a rank number as an ordinal string (e.g. 1st, 2nd, 3rd, 11th). */
const ordinal = (n: number): string => {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
};

export const PostGameRecap: React.FC<PostGameRecapProps> = ({ gameState }) => {
  const navigate = useNavigate();
  const winnerInfo = gameState.winner ? gameState.teams[gameState.winner] : null;
  const winnerColor = winnerInfo ? slotColor(winnerInfo.slotIndex) : getNeutralColor();

  const timeline = useMemo(() => gameState.logs.filter(isMilestone), [gameState.logs]);

  const coinRush = isCoinRush(gameState.mode);
  /** Total placement bonuses calculated from team standings. */
  const finishBonusTotal = useMemo(
    () => gameState.standings.reduce((sum, s) => sum + s.finishBonus, 0),
    [gameState.standings]
  );

  const stats = useMemo(() => {
    const submissions = Object.values(gameState.submissions);
    const passed = submissions.filter((s) => s.status === 'pass').length;
    const failed = submissions.filter((s) => s.status === 'fail').length;
    const disputes = Object.values(gameState.disputes);
    const upheld = disputes.filter((d) => d.status === 'upheld').length;
    const overturned = disputes.filter((d) => d.status === 'overturned').length;
    const gmOverrides = gameState.logs.filter((l) => l.startsWith('[GM]')).length;
    const { earned, spent } = sumCoinDeltas(gameState.logs);
    return {
      totalChallenges: submissions.length,
      passed,
      failed,
      totalDisputes: disputes.length,
      upheld,
      overturned,
      gmOverrides,
      earned,
      spent
    };
  }, [gameState.submissions, gameState.disputes, gameState.logs]);

  const columns: BoardColumn<FinalStandingRow>[] = [
    {
      key: 'team',
      header: 'Team',
      who: true,
      render: (row) => {
        const info = gameState.teams[row.teamId];
        const color = info ? slotColor(info.slotIndex).color : getNeutralColor().color;
        return (
          <>
            <span className="game-pane__dot" style={{ backgroundColor: color }} />
            <span>{row.teamName}</span>
          </>
        );
      }
    },
    // In coin rush, coins determine the winner and lead the standings table.
    ...(coinRush
      ? [
          {
            key: 'coins',
            header: 'Coins',
            numeric: true,
            render: (row: FinalStandingRow) => <><IconCoin /> {row.coins}</>
          } as BoardColumn<FinalStandingRow>,
          {
            key: 'placed',
            header: 'Finish',
            numeric: true,
            render: (row: FinalStandingRow) => (
              <>{row.finishRank ? `${ordinal(row.finishRank)} · +${row.finishBonus}` : 'DNF'}</>
            )
          } as BoardColumn<FinalStandingRow>
        ]
      : []),
    {
      key: 'waypoints',
      header: 'Waypoints',
      numeric: true,
      render: (row) => <>{row.waypointsReached}</>
    },
    ...(coinRush
      ? []
      : [
          {
            key: 'coins',
            header: 'Coins',
            numeric: true,
            render: (row: FinalStandingRow) => <><IconCoin /> {row.coins}</>
          } as BoardColumn<FinalStandingRow>
        ]),
    {
      key: 'distance',
      header: 'Distance left',
      numeric: true,
      render: (row) => <>{(row.distanceToFinishM / 1000).toFixed(1)} km</>
    }
  ];

  const rows: FinalStandingRow[] = gameState.standings.map((s) => ({
    teamId: s.teamId,
    teamName: s.teamName,
    waypointsReached: s.waypointsReached,
    distanceToFinishM: s.distanceToFinishM,
    coins: s.coins,
    finishRank: s.finishRank,
    finishBonus: s.finishBonus
  }));

  if (gameState.state !== 'ended') {
    return <Empty icon="🏆" title="Race still in progress" description="The recap appears once the race has ended." />;
  }

  return (
    <div className="post-game-recap">
      <Hero className="post-game-recap__hero">
        <Sticker tone={winnerInfo && winnerInfo.slotIndex % 2 === 0 ? 'amber' : 'red'}>
          <span style={{ fontSize: '2rem' }}>🏆</span>
        </Sticker>
        <h1 className="t-announce fs-d-lg" style={{ color: winnerColor.color, margin: 0 }}>
          {winnerInfo ? `${winnerInfo.name} WINS` : 'RACE COMPLETE'}
        </h1>
        {/* In coin rush, display the total coins banked by the winner. */}
        {coinRush && winnerInfo && (
          <p className="fs-5" style={{ color: 'var(--ink-muted)', margin: 'var(--sp-2) 0 0' }}>
            <IconCoin /> {gameState.standings.find((s) => s.teamId === gameState.winner)?.coins ?? 0} banked — the most on
            the board.
          </p>
        )}
      </Hero>

      <Card className="card--pad">
        <h2 className="t-announce fs-6" style={{ margin: '0 0 var(--sp-3)', color: 'var(--ink-strong)' }}>FINAL STANDINGS</h2>
        {rows.length > 0 ? (
          <Board columns={columns} rows={rows} rowKey={(row) => row.teamId} isLeader={(_, i) => i === 0} />
        ) : (
          <p className="fs-5" style={{ color: 'var(--ink-muted)' }}>No standings recorded.</p>
        )}
      </Card>

      <Card className="card--pad">
        <h2 className="t-announce fs-6" style={{ margin: '0 0 var(--sp-3)', color: 'var(--ink-strong)' }}>STATISTICS</h2>
        <div className="post-game-recap__stats">
          <div><span className="fs-8 t-data">{stats.totalChallenges}</span><span className="fs-3">challenges attempted</span></div>
          <div><span className="fs-8 t-data">{stats.passed}</span><span className="fs-3">passed</span></div>
          <div><span className="fs-8 t-data">{stats.failed}</span><span className="fs-3">failed</span></div>
          <div><span className="fs-8 t-data">{stats.totalDisputes}</span><span className="fs-3">disputes raised</span></div>
          <div><span className="fs-8 t-data">{stats.upheld}</span><span className="fs-3">upheld</span></div>
          <div><span className="fs-8 t-data">{stats.overturned}</span><span className="fs-3">dismissed</span></div>
          <div><span className="fs-8 t-data">{stats.gmOverrides}</span><span className="fs-3">GM overrides</span></div>
          <div>
            <span className="fs-8 t-data"><IconCoin /> {stats.earned - finishBonusTotal}</span>
            <span className="fs-3">{coinRush ? 'earned on the route' : 'coins earned'}</span>
          </div>
          {coinRush && (
            <div>
              <span className="fs-8 t-data"><IconCoin /> {finishBonusTotal}</span>
              <span className="fs-3">paid at the line</span>
            </div>
          )}
          <div><span className="fs-8 t-data"><IconCoin /> {stats.spent}</span><span className="fs-3">coins spent</span></div>
        </div>
      </Card>

      <Card className="card--pad">
        <h2 className="t-announce fs-6" style={{ margin: '0 0 var(--sp-3)', color: 'var(--ink-strong)' }}>TIMELINE</h2>
        {timeline.length > 0 ? (
          <ul className="post-game-recap__timeline">
            {timeline.map((line, i) => (
              <li key={i} className="t-data fs-4">{line}</li>
            ))}
          </ul>
        ) : (
          <p className="fs-5" style={{ color: 'var(--ink-muted)' }}>No milestones recorded.</p>
        )}
      </Card>

      {/* Link to the detailed race report containing evidence photos and full logs. */}
      <Card className="card--pad">
        <h2 className="t-announce fs-6" style={{ margin: '0 0 var(--sp-2)', color: 'var(--ink-strong)' }}>
          THE FULL REPORT
        </h2>
        <p className="fs-5" style={{ color: 'var(--ink-muted)', margin: '0 0 var(--sp-3)' }}>
          Every photo submitted in this race, what it was taken for, and what graded it — plus the button that
          deletes the whole race now rather than in 30 days.
        </p>
        <Button variant="secondary" onClick={() => navigate(`/race/${gameState.gameId}/report`)}>
          📸 Open the race report
        </Button>
      </Card>
    </div>
  );
};
export default PostGameRecap;
