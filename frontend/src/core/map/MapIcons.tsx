import React from 'react';

/**
 * Wayfinding vector icon set for map controls and overlay chrome elements.
 */
const glyph = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2.2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  className: 'ic',
  'aria-hidden': true,
  focusable: 'false'
} as const;

export const IconPalette: React.FC = () => (
  <svg {...glyph}>
    <path d="M12 3.2a8.8 8.8 0 0 0 0 17.6c1.5 0 2.2-.9 2.2-1.9 0-1.3-1.1-1.7-1.1-2.8 0-.8.7-1.4 1.6-1.4h1.6a4.5 4.5 0 0 0 4.5-4.5c0-3.9-4-7-8.8-7z" />
    <path d="M7.6 12.4h.01M9.9 8.3h.01M14.4 7.9h.01" />
  </svg>
);

export const IconFitBounds: React.FC = () => (
  <svg {...glyph}>
    <path d="M3.4 8.6V4.8a1.4 1.4 0 0 1 1.4-1.4h3.8M15.4 3.4h3.8a1.4 1.4 0 0 1 1.4 1.4v3.8M20.6 15.4v3.8a1.4 1.4 0 0 1-1.4 1.4h-3.8M8.6 20.6H4.8a1.4 1.4 0 0 1-1.4-1.4v-3.8" />
    <circle cx="12" cy="12" r="2.6" />
  </svg>
);

export const IconAuto: React.FC = () => (
  <svg {...glyph}>
    <path d="M13.2 2.8 5.2 13.2h5.4l-1 8 8-10.4h-5.4z" />
  </svg>
);

export const IconBasemap: React.FC = () => (
  <svg {...glyph}>
    <path d="M12 3.4 3.2 8 12 12.6 20.8 8z" />
    <path d="M3.2 13.2 12 17.8l8.8-4.6" />
  </svg>
);

export const IconSatellite: React.FC = () => (
  <svg {...glyph}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M12 3.4v2.4M12 18.2v2.4M3.4 12h2.4M18.2 12h2.4" />
    <path d="M5.9 5.9 7.6 7.6M16.4 16.4l1.7 1.7M18.1 5.9l-1.7 1.7M7.6 16.4l-1.7 1.7" />
  </svg>
);

export const IconMoon: React.FC = () => (
  <svg {...glyph}>
    <path d="M20.4 14.2A8.8 8.8 0 0 1 9.8 3.6a8.8 8.8 0 1 0 10.6 10.6z" />
  </svg>
);

export const IconLegend: React.FC = () => (
  <svg {...glyph}>
    <path d="M4.2 6.4h3.2M4.2 12h3.2M4.2 17.6h3.2" />
    <path d="M11.4 6.4h8.4M11.4 12h8.4M11.4 17.6h8.4" />
  </svg>
);

export const IconRoadblockSign: React.FC = () => (
  <svg {...glyph}>
    <rect x="2.8" y="8.2" width="18.4" height="7.6" rx="1.6" />
    <path d="M7.4 15.8 11 8.2M13 15.8 16.6 8.2" />
  </svg>
);

export const IconLock: React.FC = () => (
  <svg {...glyph}>
    <rect x="4.8" y="10.4" width="14.4" height="10.2" rx="2" />
    <path d="M8.2 10.4V7.2a3.8 3.8 0 0 1 7.6 0v3.2" />
  </svg>
);

export const IconTarget: React.FC = () => (
  <svg {...glyph}>
    <circle cx="12" cy="12" r="8.4" />
    <circle cx="12" cy="12" r="3.4" />
    <path d="M12 1.8v2.6M12 19.6v2.6M1.8 12h2.6M19.6 12h2.6" />
  </svg>
);

export const IconPin: React.FC = () => (
  <svg {...glyph}>
    <path d="M12 21.2c4.3-4.1 6.5-7.4 6.5-10.2a6.5 6.5 0 1 0-13 0c0 2.8 2.2 6.1 6.5 10.2z" />
    <circle cx="12" cy="10.7" r="2.4" />
  </svg>
);

export const IconFlag: React.FC = () => (
  <svg {...glyph}>
    <path d="M5.4 21.4V3.2" />
    <path d="M5.4 4.2h12.4l-2.4 4 2.4 4H5.4z" />
  </svg>
);

export const IconTick: React.FC = () => (
  <svg {...glyph}>
    <path d="M4.6 12.6 9.4 17.4 19.4 7.4" />
  </svg>
);

export const IconCoin: React.FC = () => (
  <svg {...glyph}>
    <circle cx="12" cy="12" r="8.4" />
    <path d="M12 7.2v9.6M14.2 9.2h-3.2a1.8 1.8 0 0 0 0 3.6h2a1.8 1.8 0 0 1 0 3.6h-3.2" />
  </svg>
);
