import React from 'react';
import {
  IconCheck,
  IconMap,
  IconPowerup,
  IconChallenge
} from './EditorIcons';

export type EditorTabId = 'elements' | 'challenges' | 'decks' | 'powerups' | 'validation';

export interface EditorTabDef {
  id: EditorTabId;
  /** Strip label — one short word, so five of them fit across a 320px pane. */
  label: string;
  /** The unabbreviated label displayed when width permits. */
  fullLabel: string;
  /** Hover/spoken name, which the terse strip label cannot serve as. */
  title: string;
  icon: React.ReactNode;
}

export const EDITOR_TABS: EditorTabDef[] = [
  { id: 'elements', label: 'Map', fullLabel: 'Map', title: 'Map geometry', icon: <IconMap /> },
  { id: 'challenges', label: 'Challenges', fullLabel: 'Challenges', title: 'Waypoint challenges', icon: <IconChallenge /> },
  // Decks tab inactive for current PoC
  // { id: 'decks', label: 'Decks', fullLabel: 'Decks', title: 'Roadblock & curse decks', icon: <IconDeck /> },
  { id: 'powerups', label: 'Power', fullLabel: 'Power-ups', title: 'Power-ups', icon: <IconPowerup /> },
  { id: 'validation', label: 'Issues', fullLabel: 'Validation', title: 'Validation', icon: <IconCheck /> }
];

