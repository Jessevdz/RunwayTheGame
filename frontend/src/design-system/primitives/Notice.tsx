import React from 'react';

export interface NoticeProps {
  /** Severity. `info` is the unmarked default. */
  kind?: 'info' | 'warn' | 'stop';
  /** Bolded lead line above the body. */
  title?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

/** Inline advisory card component with severity dot indicator. */
export const Notice: React.FC<NoticeProps> = ({
  kind = 'info',
  title,
  children,
  className = '',
  style,
}) => {
  const kindClass = kind === 'warn' ? 'notice--warn' : kind === 'stop' ? 'notice--stop' : '';

  return (
    <div className={`notice ${kindClass} ${className}`.trim()} style={style}>
      <span className="notice__mark" aria-hidden="true" />
      <div>
        {title && <b>{title}</b>}
        {children}
      </div>
    </div>
  );
};
