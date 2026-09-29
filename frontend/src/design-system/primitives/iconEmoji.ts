import type { IconName } from './iconShapes';

const EMOJI_TO_ICON: Record<string, IconName> = {
  '⚡': 'powerup',
  '❄️': 'snowflake',
  '❄': 'snowflake',
  '⏳': 'hourglass',
  '👁️': 'eye-off',
  '👁': 'eye-off',
  '💀': 'skull',
  '🏁': 'flag',
  '📍': 'pin',
  '📷': 'camera',
  '📸': 'camera',
  '🪙': 'coin',
  '💰': 'coin',
  '🛒': 'cart',
  '🚧': 'barrier',
  '🛡️': 'shield',
  '🛡': 'shield',
  '🎯': 'target',
  '🧭': 'compass',
  '🔑': 'key',
  '🕐': 'clock',
  '⏱️': 'clock',
  '⏱': 'clock',
  '🔒': 'lock',
  '🗺️': 'map',
  '🗺': 'map',
  '🏆': 'trophy',
  '📶': 'wifi-off',
  '✅': 'check-circle',
  '⚠️': 'warning',
  '⚠': 'warning',
};

/** Maps a backend-supplied emoji string to an icon name, or undefined when it has no counterpart. */
export function iconNameForEmoji(emoji: string | undefined | null): IconName | undefined {
  if (!emoji) return undefined;
  return EMOJI_TO_ICON[emoji.trim()];
}
