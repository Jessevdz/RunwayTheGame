import React from 'react';

export interface BoardColumn<T> {
  key: string;
  header: React.ReactNode;
  /** Right-aligns and applies tabular numerals. */
  numeric?: boolean;
  /** Renders as the identity cell — avatar/colour swatch plus name. */
  who?: boolean;
  render: (row: T) => React.ReactNode;
}

export interface BoardProps<T> {
  columns: BoardColumn<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  /** Marks the leading row; the CSS appends a "LEADING" flag to its who-cell. */
  isLeader?: (row: T, index: number) => boolean;
  className?: string;
  style?: React.CSSProperties;
}

/** Flight-board standings table. */
export function Board<T>({
  columns,
  rows,
  rowKey,
  isLeader,
  className = '',
  style,
}: BoardProps<T>) {
  return (
    <table className={`board ${className}`.trim()} style={style}>
      <thead>
        <tr>
          {columns.map((col) => (
            <th key={col.key} className={col.numeric ? 'num' : ''}>
              {col.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={rowKey(row, i)} data-lead={isLeader?.(row, i) ? 'true' : undefined}>
            {columns.map((col) => (
              <td key={col.key} className={col.numeric ? 'num' : ''}>
                {col.who ? <div className="who">{col.render(row)}</div> : col.render(row)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
