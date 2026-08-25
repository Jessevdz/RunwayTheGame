import React from 'react';

export interface StatProps {
  label: string;
  value: React.ReactNode;
  hint?: string;
  /** Colours the top rule. Default is `--ink`. */
  tone?: 'hot' | 'warm' | 'bright';
  className?: string;
  style?: React.CSSProperties;
}

/** Metric display block component featuring top accent rule and label. */
export const Stat: React.FC<StatProps> = ({ label, value, hint, tone, className = '', style }) => {
  const toneClass = tone ? `stat--${tone}` : '';

  return (
    <div className={`stat ${toneClass} ${className}`.trim()} style={style}>
      <span>{label}</span>
      <b>{value}</b>
      {hint && <span>{hint}</span>}
    </div>
  );
};
