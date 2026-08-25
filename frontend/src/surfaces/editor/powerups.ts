export interface PowerupDraft {
  id: string;
  icon?: string;
  name: string;
  description: string;
  cost: number;
  /** Active duration in seconds. 0 means the powerup is instantaneous. */
  duration_s: number;
  /** Binds the powerup to a known engine behaviour, or 'generic' for a plain item. */
  effect: PowerupEffect;
}

export type PowerupEffect =
  | 'nerf'
  | 'tracker_off'
  | 'challenge_skip';
  /* | 'generic' | 'roadblock' | 'curse' */

/** Effect metadata mapping powerup types to engine behaviors and display labels. */
export const POWERUP_EFFECTS: Record<
  PowerupEffect,
  { label: string; hint: string; timed: boolean }
> = {
  /* Inactive for current PoC
  generic: {
    label: 'Generic item',
    hint: 'A plain purchasable item with no special server behaviour.',
    timed: false
  },
  */
  nerf: {
    label: 'Freeze opponent',
    hint: 'Freezes the target team for the configured duration.',
    timed: true
  },
  tracker_off: {
    label: 'Hide position',
    hint: 'Hides the buyer’s position dot for the configured duration.',
    timed: true
  },
  /* Inactive for current PoC
  roadblock: {
    label: 'Place roadblock',
    hint: 'Places a roadblock challenge on a chosen road.',
    timed: false
  },
  curse: {
    label: 'Draw curse',
    hint: 'Draws and applies a curse card to the opponent.',
    timed: false
  },
  */
  challenge_skip: {
    label: 'Skip challenge',
    hint: 'Bypasses the buyer’s current blocking challenge immediately.',
    timed: false
  }
};

export const newPowerupId = () =>
  `powerup-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

/** Human-friendly duration for the summary/preview. */
export function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return 'Instant';
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

export const DEFAULT_POWERUPS: PowerupDraft[] = [
  {
    id: 'nerf',
    name: 'Nerf Dart',
    description: 'Freeze the opponent team, halting their progress.',
    cost: 10,
    duration_s: 1800,
    effect: 'nerf'
  },
  /* Inactive for current PoC
  {
    id: 'roadblock',
    name: 'Roadblock',
    description: 'Block a road of your choice with a roadblock challenge.',
    cost: 15,
    duration_s: 0,
    effect: 'roadblock'
  },
  */
  {
    id: 'tracker_off',
    name: 'Tracker Off',
    description: 'Hide your map position dot from opponents.',
    cost: 25,
    duration_s: 2700,
    effect: 'tracker_off'
  },
  /* Inactive for current PoC
  {
    id: 'curse',
    name: 'Curse',
    description: 'Curse your opponent, forcing them to satisfy a travel constraint.',
    cost: 25,
    duration_s: 0,
    effect: 'curse'
  },
  */
  {
    id: 'challenge_skip',
    name: 'Challenge Skip',
    description: 'Bypass your current blocking challenge immediately without penalty.',
    cost: 100,
    duration_s: 0,
    effect: 'challenge_skip'
  }
];

/** Ensures default powerup definitions are present, merging saved custom values. */
export function ensureDefaultPowerups(savedPowerups?: PowerupDraft[]): PowerupDraft[] {
  if (!savedPowerups || savedPowerups.length === 0) {
    return JSON.parse(JSON.stringify(DEFAULT_POWERUPS));
  }
  return DEFAULT_POWERUPS.map((def) => {
    const found = savedPowerups.find((p) => p.id === def.id || p.effect === def.effect);
    if (!found) return { ...def };
    return {
      ...def,
      name: def.name,
      description: def.description,
      cost: typeof found.cost === 'number' ? found.cost : def.cost,
      duration_s: typeof found.duration_s === 'number' ? found.duration_s : def.duration_s
    };
  });
}

