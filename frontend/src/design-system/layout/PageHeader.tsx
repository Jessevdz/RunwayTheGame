import React from 'react';
import { BrandMark } from '../primitives/BrandMark';

export interface PageHeaderProps {
  title: React.ReactNode;
  /** Small label above the title. */
  eyebrow?: React.ReactNode;
  /** Shows a back button that calls this handler. */
  onBack?: () => void;
  backLabel?: string;
  /** Right-aligned controls that wrap under the title on narrow screens. */
  actions?: React.ReactNode;
  /** Puts the RUNWAY brand mark above the title. */
  brand?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

/** Page title row with optional brand mark, back button and actions, padded by --page-pad. */
export const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  eyebrow,
  onBack,
  backLabel = 'Back',
  actions,
  brand = false,
  className = '',
  style,
}) => (
  <header className={`page-header ${className}`.trim()} style={style}>
    {brand && <BrandMark className="page-header__brand" />}
    <div className="page-header__row">
      {onBack && (
        <button type="button" className="page-header__back" onClick={onBack} aria-label={backLabel}>
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
      <div className="page-header__lead">
        {eyebrow && <span className="t-label fs-label page-header__eyebrow">{eyebrow}</span>}
        <h1 className="page-header__title t-announce">{title}</h1>
      </div>
      {actions && <div className="page-header__actions">{actions}</div>}
    </div>
  </header>
);
