import React from 'react';

/**
 * Wayfinding icon set for the map design pane.
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

export const IconCursor: React.FC = () => (
  <svg {...glyph}>
    <path d="M5.5 3.2 11.7 19l2.1-6.1 6.1-2.1z" />
  </svg>
);

export const IconWaypoint: React.FC = () => (
  <svg {...glyph}>
    <path d="M12 21.2c4.3-4.1 6.5-7.4 6.5-10.2a6.5 6.5 0 1 0-13 0c0 2.8 2.2 6.1 6.5 10.2z" />
    <circle cx="12" cy="10.7" r="2.4" />
  </svg>
);

export const IconRoad: React.FC = () => (
  <svg {...glyph}>
    <circle cx="5.8" cy="18.2" r="2.6" />
    <circle cx="18.2" cy="5.8" r="2.6" />
    <path d="M7.7 16.3 16.3 7.7" />
  </svg>
);

export const IconStart: React.FC = () => (
  <svg {...glyph}>
    <circle cx="12" cy="12" r="8.6" />
    <path d="M10.2 8.4 15.8 12l-5.6 3.6z" />
  </svg>
);

export const IconFinish: React.FC = () => (
  <svg {...glyph}>
    <path d="M5 21.5V3" />
    <path d="M5 4.2h13.4l-2.6 4.3 2.6 4.3H5z" />
  </svg>
);

export const IconMap: React.FC = () => (
  <svg {...glyph}>
    <path d="M9 3.6 3 6.3v14.1L9 17.7l6 2.7 6-2.7V3.6l-6 2.7z" />
    <path d="M9 3.6v14.1M15 6.3v14.1" />
  </svg>
);

export const IconChallenge: React.FC = () => (
  <svg {...glyph}>
    <circle cx="12" cy="12" r="8.4" />
    <circle cx="12" cy="12" r="3.2" />
  </svg>
);

export const IconDeck: React.FC = () => (
  <svg {...glyph}>
    <rect x="3.2" y="6.6" width="11.2" height="14.2" rx="2" />
    <path d="M7.6 3.9h9.3a2 2 0 0 1 2 2v11.3" />
  </svg>
);

export const IconPowerup: React.FC = () => (
  <svg {...glyph}>
    <path d="M13.6 2.6 4.8 13.4h5.9l-.9 8 8.8-10.8h-5.9z" />
  </svg>
);

export const IconCoin: React.FC = () => (
  <svg {...glyph}>
    <circle cx="12" cy="12" r="8.4" />
    <path d="M12 7.2v9.6M14.2 9.2h-3.2a1.8 1.8 0 0 0 0 3.6h2a1.8 1.8 0 0 1 0 3.6h-3.2" />
  </svg>
);

export const IconCheck: React.FC = () => (
  <svg {...glyph}>
    <path d="M10.4 3.9 2.7 17.3A1.8 1.8 0 0 0 4.3 20h15.4a1.8 1.8 0 0 0 1.6-2.7L13.6 3.9a1.8 1.8 0 0 0-3.2 0z" />
    <path d="M12 9.4v4.2M12 17h.01" />
  </svg>
);

export const IconBack: React.FC = () => (
  <svg {...glyph}>
    <path d="M19.5 12H4.5M10.5 18 4.5 12l6-6" />
  </svg>
);

export const IconChevronLeft: React.FC = () => (
  <svg {...glyph}>
    <path d="M15 4.8 7.8 12 15 19.2" />
  </svg>
);

export const IconChevronRight: React.FC = () => (
  <svg {...glyph}>
    <path d="M9 4.8 16.2 12 9 19.2" />
  </svg>
);

export const IconShare: React.FC = () => (
  <svg {...glyph}>
    <path d="M10.6 13.4a4.6 4.6 0 0 0 6.5 0l2.5-2.5a4.6 4.6 0 1 0-6.5-6.5l-1.4 1.4" />
    <path d="M13.4 10.6a4.6 4.6 0 0 0-6.5 0l-2.5 2.5a4.6 4.6 0 1 0 6.5 6.5l1.4-1.4" />
  </svg>
);

export const IconSave: React.FC = () => (
  <svg {...glyph}>
    <path d="M4.8 3.2h11L19.2 6.6v14.2H4.8z" />
    <path d="M8.4 3.2v6h7.2v-6M8.4 20.8v-6h7.2v6" />
  </svg>
);

export const IconTrash: React.FC = () => (
  <svg {...glyph}>
    <path d="M3.8 6.6h16.4M9.8 3.6h4.4M6.4 6.6l1 13.2a1.6 1.6 0 0 0 1.6 1.5h6a1.6 1.6 0 0 0 1.6-1.5l1-13.2" />
  </svg>
);

export const IconLocate: React.FC = () => (
  <svg {...glyph}>
    <circle cx="12" cy="12" r="6.4" />
    <path d="M12 1.8v3.2M12 19v3.2M1.8 12H5M19 12h3.2" />
  </svg>
);

export const IconImport: React.FC = () => (
  <svg {...glyph}>
    <path d="M12 3v11M7 9l5 5 5-5M4 19.5h16" />
  </svg>
);

export const IconExport: React.FC = () => (
  <svg {...glyph}>
    <path d="M12 15V4M7 9l5-5 5 5M4 19.5h16" />
  </svg>
);

export const IconPlus: React.FC = () => (
  <svg {...glyph}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

/** Offset pair of cards — "duplicate this one", distinct from IconDeck's portrait stack. */
export const IconDuplicate: React.FC = () => (
  <svg {...glyph}>
    <rect x="9" y="9" width="10.8" height="10.8" rx="2" />
    <path d="M15 5.2H6.4a1.8 1.8 0 0 0-1.8 1.8v8.6" />
  </svg>
);

/** Circular arrow — restore the shipped defaults. */
export const IconReset: React.FC = () => (
  <svg {...glyph}>
    <path d="M20.4 12a8.4 8.4 0 1 1-2.5-5.9" />
    <path d="M20.8 3.4v5.2h-5.2" />
  </svg>
);

export const IconClock: React.FC = () => (
  <svg {...glyph}>
    <circle cx="12" cy="12" r="8.4" />
    <path d="M12 6.8V12l3.4 2" />
  </svg>
);

/** Confirming tick icon component. */
export const IconDone: React.FC = () => (
  <svg {...glyph}>
    <path d="M4.8 12.6 9.6 17.4 19.2 6.6" />
  </svg>
);

/** Stop-sign octagon — the roadblock deck's mark. */
export const IconRoadblock: React.FC = () => (
  <svg {...glyph}>
    <path d="M8.6 3.2h6.8l5.4 5.4v6.8l-5.4 5.4H8.6l-5.4-5.4V8.6z" />
  </svg>
);

/** Skull — the curse deck's mark. */
export const IconCurse: React.FC = () => (
  <svg {...glyph}>
    <path d="M12 3.2a7.6 7.6 0 0 0-7.6 7.6c0 2.5 1.2 4.2 2.7 5.3v2.5a1.6 1.6 0 0 0 1.6 1.6h6.6a1.6 1.6 0 0 0 1.6-1.6v-2.5c1.5-1.1 2.7-2.8 2.7-5.3A7.6 7.6 0 0 0 12 3.2z" />
    <path d="M9.3 10.9h.01M14.7 10.9h.01" />
  </svg>
);

