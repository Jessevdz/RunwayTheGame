import React from 'react';

interface GameLogFeedProps {
  logs: string[];
  emptyLabel?: string;
}

export const GameLogFeed: React.FC<GameLogFeedProps> = ({ logs, emptyLabel = 'Waiting for game events...' }) => {
  return (
    <div
      style={{
        flex: 1,
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column-reverse',
        gap: 'var(--sp-2)',
        background: 'var(--surface)',
        border: '0.0625rem solid var(--line)',
        borderRadius: 'var(--r-md)',
        padding: 'var(--sp-3)',
        maxHeight: '25rem'
      }}
    >
      {logs
        .slice()
        .reverse()
        .map((line, index) => (
          <div
            key={`${index}-${line.slice(0, 24)}`}
            className="t-data fs-4"
            style={{
              lineHeight: '1.4',
              padding: 'var(--sp-2) var(--sp-3)',
              borderRadius: 'var(--r-sm)',
              background: 'var(--surface-2)',
              borderLeft: '0.1875rem solid var(--accent)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 'var(--sp-2)'
            }}
          >
            <span style={{ color: 'var(--ink)' }}>{line}</span>
          </div>
        ))}

      {logs.length === 0 && (
        <div className="t-data fs-3" style={{ padding: 'var(--sp-4)', textAlign: 'center', color: 'var(--ink-muted)' }}>
          {emptyLabel}
        </div>
      )}
    </div>
  );
};
export default GameLogFeed;
