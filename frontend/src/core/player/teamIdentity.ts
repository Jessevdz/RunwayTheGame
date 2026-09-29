/** Team colour slots, matching the --team-0 to --team-5 tokens. */
export const TEAM_SLOT_COUNT = 6;

const hashId = (id: string): number => {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
};

/** The colour slot for a team: its server-assigned slot when known, otherwise a stable pick from its id. */
export function teamSlot(teamId: string, teams?: Record<string, { slotIndex: number }>): number {
  const known = teams?.[teamId]?.slotIndex;
  const raw = typeof known === 'number' && Number.isFinite(known) ? known : hashId(teamId);
  return ((Math.floor(raw) % TEAM_SLOT_COUNT) + TEAM_SLOT_COUNT) % TEAM_SLOT_COUNT;
}

/** CSS colour for a slot, following the theme through the token. */
export const teamColorVar = (slot: number): string => `var(--team-${slot})`;

/** Up to two capital letters that stand for a team name. */
export function teamInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return Array.from(words[0]).slice(0, 2).join('').toUpperCase();
  return (Array.from(words[0])[0] + Array.from(words[1])[0]).toUpperCase();
}
