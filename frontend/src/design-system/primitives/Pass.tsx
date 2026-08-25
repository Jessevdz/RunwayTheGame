import React from 'react';

export interface PassProps {
  title?: React.ReactNode;
  /** Endpoints of the route line; the dashed rule is drawn between them. */
  from?: React.ReactNode;
  to?: React.ReactNode;
  /** Torn-off stub on the right: a big figure over a small caption. */
  stubValue?: React.ReactNode;
  stubLabel?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

/** Boarding-pass card — the signature travel motif, stub and all. */
export const Pass: React.FC<PassProps> = ({
  title,
  from,
  to,
  stubValue,
  stubLabel,
  children,
  className = '',
  style,
}) => {
  return (
    <article className={`pass ${className}`.trim()} style={style}>
      <div className="pass__main">
        {title && <h3 className="pass__title">{title}</h3>}
        {(from || to) && (
          <div className="pass__route">
            <span>{from}</span>
            <i aria-hidden="true" />
            <span>{to}</span>
          </div>
        )}
        {children}
      </div>
      {(stubValue || stubLabel) && (
        <div className="pass__stub">
          {stubValue && <b>{stubValue}</b>}
          {stubLabel && <span>{stubLabel}</span>}
        </div>
      )}
    </article>
  );
};
