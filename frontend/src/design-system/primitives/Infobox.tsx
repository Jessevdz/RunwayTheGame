import React from 'react';

export interface InfoboxRow {
  term: React.ReactNode;
  detail: React.ReactNode;
}

export interface InfoboxProps {
  title?: React.ReactNode;
  /** Definition rows. Supply either these or `children`, not both. */
  rows?: InfoboxRow[];
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

/** Navy-headed definition panel for rules, specs and match metadata. */
export const Infobox: React.FC<InfoboxProps> = ({
  title,
  rows,
  children,
  className = '',
  style,
}) => {
  return (
    <div className={`infobox ${className}`.trim()} style={style}>
      {title && (
        <div className="infobox__head">
          <h4>{title}</h4>
        </div>
      )}
      {rows && rows.length > 0 && (
        <dl>
          {rows.map((row, i) => (
            <React.Fragment key={i}>
              <dt>{row.term}</dt>
              <dd>{row.detail}</dd>
            </React.Fragment>
          ))}
        </dl>
      )}
      {children}
    </div>
  );
};
