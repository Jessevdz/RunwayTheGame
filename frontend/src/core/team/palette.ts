import { useState, useEffect } from 'react';
import { resolveToken, onTokenChange } from '@ds';

/** Resolves team slot colors dynamically from design system CSS tokens. */

export interface SlotColor {
  color: string;
  bg: string;
  label: string;
}

export function getTeamPalette(): SlotColor[] {
  return [
    { color: resolveToken('--team-0'), bg: resolveToken('--team-0-bg'), label: 'Red' },
    { color: resolveToken('--team-1'), bg: resolveToken('--team-1-bg'), label: 'Yellow' },
    { color: resolveToken('--team-2'), bg: resolveToken('--team-2-bg'), label: 'Blue' },
    { color: resolveToken('--team-3'), bg: resolveToken('--team-3-bg'), label: 'Green' },
    { color: resolveToken('--team-4'), bg: resolveToken('--team-4-bg'), label: 'Orange' },
    { color: resolveToken('--team-5'), bg: resolveToken('--team-5-bg'), label: 'Navy' },
  ];
}

export function getNeutralColor(): SlotColor {
  return {
    color: resolveToken('--team-neutral'),
    bg: resolveToken('--team-neutral-bg'),
    label: 'Neutral',
  };
}

export function slotColor(slotIndex: number): SlotColor {
  const palette = getTeamPalette();
  return palette[((slotIndex % palette.length) + palette.length) % palette.length];
}

export function useTeamPalette(): SlotColor[] {
  const [palette, setPalette] = useState<SlotColor[]>(getTeamPalette);

  useEffect(() => {
    return onTokenChange(() => {
      setPalette(getTeamPalette());
    });
  }, []);

  return palette;
}

export interface TeamInfoLike {
  name: string;
  slotIndex: number;
}

export function getTeamColor(teamId: string | null | undefined, teams: { [id: string]: TeamInfoLike }): string {
  if (!teamId || !teams[teamId]) return getNeutralColor().color;
  return slotColor(teams[teamId].slotIndex).color;
}

export function getTeamBg(teamId: string | null | undefined, teams: { [id: string]: TeamInfoLike }): string {
  if (!teamId || !teams[teamId]) return getNeutralColor().bg;
  return slotColor(teams[teamId].slotIndex).bg;
}

export function getTeamName(teamId: string | null | undefined, teams: { [id: string]: TeamInfoLike }): string {
  if (!teamId) return 'Neutral';
  return teams[teamId]?.name || 'Unclaimed Team';
}
