import React from 'react';

const glyph = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2.2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  className: 'ic',
  'aria-hidden': true,
  focusable: 'false',
} as const;

/** Documentation book icon following the design system wayfinding 24px grid / 2.2px stroke. */
export const IconBook: React.FC = () => (
  <svg {...glyph}>
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
  </svg>
);

/** GitHub icon following the design system wayfinding 24px grid / 2.2px stroke. */
export const IconGithub: React.FC = () => (
  <svg {...glyph}>
    <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
    <path d="M9 18c-4.51 2-5-2-7-2" />
  </svg>
);

/** Coin icon following the design system wayfinding 24px grid / 2.2px stroke. */
export const IconCoin: React.FC<{ className?: string }> = ({ className = '' }) => (
  <svg {...glyph} className={`ic ${className}`.trim()}>
    <circle cx="12" cy="12" r="8.4" />
    <path d="M12 7.2v9.6M14.2 9.2h-3.2a1.8 1.8 0 0 0 0 3.6h2a1.8 1.8 0 0 1 0 3.6h-3.2" />
  </svg>
);

/** Sign out icon following the design system wayfinding 24px grid / 2.2px stroke. */
export const IconSignOut: React.FC<{ className?: string }> = ({ className = '' }) => (
  <svg {...glyph} className={`ic ${className}`.trim()}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="M16 17l5-5-5-5" />
    <path d="M21 12H9" />
  </svg>
);

