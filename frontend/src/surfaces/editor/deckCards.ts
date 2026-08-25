import type React from 'react';
import { IconCurse, IconRoadblock } from './components/EditorIcons';

export interface CardDraft {
  id: string;
  text: string;
}

export type DeckKind = 'roadblock' | 'curse';

/** Parses a combined title and description string into card component fields. */
export function parseCard(text: string): { title: string; description: string } {
  const t = (text ?? '').trim();
  const idx = t.indexOf(': ');
  // Only treat the leading segment as a title when it's short and reads like a label
  // (no sentence-ending punctuation). Otherwise the whole string is the body.
  if (idx > 0 && idx <= 48 && !/[.!?]/.test(t.slice(0, idx))) {
    return { title: t.slice(0, idx).trim(), description: t.slice(idx + 2).trim() };
  }
  return { title: '', description: t };
}

export function joinCard(title: string, description: string): string {
  const tt = title.trim();
  const dd = description.trim();
  if (tt && dd) return `${tt}: ${dd}`;
  // Avoid emitting a fragile trailing ": " when one side is empty — store the
  // present half bare so the round-trip through parseCard stays stable.
  return tt || dd;
}

const asCards = (rows: { id: string; title: string; description: string }[]): CardDraft[] =>
  rows.map((r) => ({ id: r.id, text: joinCard(r.title, r.description) }));

export const DEFAULT_ROADBLOCKS: CardDraft[] = asCards([
  { id: 'rb-ring', title: 'Destroy one ring', description: 'Find a ring and destroy it.' },
  { id: 'rb-grape', title: 'Eat something grape flavored', description: 'Packaging must specify grape.' },
  { id: 'rb-handstand', title: 'Handstand for a minute', description: 'Unassisted, teammates can help you up.' },
  { id: 'rb-catch', title: 'Play catch', description: 'Throw back and forth 10 times at least 20 feet apart.' },
  { id: 'rb-hat', title: 'Wear a new hat', description: 'Buy and wear a hat until the rest period.' }
]);

export const DEFAULT_CURSES: CardDraft[] = asCards([
  { id: 'curse-backward', title: 'Walk Backwards', description: 'Walk backwards for the entirety of the next challenge.' },
  { id: 'curse-step', title: 'Two Steps Forward', description: 'Take one step back for every two steps forward during your next challenge.' },
  { id: 'curse-no-internet', title: 'Off the Grid', description: 'Neither team member may use the internet to research during your next challenge.' },
  { id: 'curse-dice', title: 'Roll for Steps', description: 'During your next challenge, roll a die to determine how many steps you can take forward.' },
  { id: 'curse-reward-share', title: 'Robin Hood', description: 'For the next hour, any rewards you earn are given directly to your opponents.' },
  { id: 'curse-no-e', title: 'No Letter E', description: 'For the next three hours, you may not say any words with the letter "e" in them.' },
  { id: 'curse-gas', title: 'Gas Station Sweep', description: 'For the next two hours, stop and buy local candy at every gas station passed.' },
  { id: 'curse-mcdonalds', title: 'Golden Arches', description: "For the next three McDonald's visible from the roadway, stop and eat." },
  { id: 'curse-silent', title: 'Vow of Silence', description: 'Neither team member may talk until completing the next challenge.' },
  { id: 'curse-rps', title: 'Rock Paper Scissors', description: 'You may not move forward until you beat the other team in rock, paper, scissors.' }
]);

/** Deck metadata and associated icon components. */
export const DECK_META: Record<
  DeckKind,
  { Icon: React.FC; label: string; kindLabel: string }
> = {
  roadblock: { Icon: IconRoadblock, label: 'Roadblocks', kindLabel: 'ROADBLOCK' },
  curse: { Icon: IconCurse, label: 'Curses', kindLabel: 'CURSE' }
};
