import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { Icon } from './Icon';
import { ICON_NAMES, iconMarkup } from './iconShapes';
import { iconNameForEmoji } from './iconEmoji';

describe('Icon', () => {
  it.each(ICON_NAMES)('renders %s as a 24-grid stroked svg', (name) => {
    const { container } = render(<Icon name={name} />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg?.getAttribute('stroke')).toBe('currentColor');
    expect(svg?.getAttribute('stroke-width')).toBe('2.2');
    expect(svg?.getAttribute('stroke-linecap')).toBe('round');
    expect(svg?.getAttribute('stroke-linejoin')).toBe('round');
    expect(svg?.getAttribute('fill')).toBe('none');
    expect(svg?.querySelectorAll('path, circle, rect').length).toBeGreaterThan(0);
  });

  it('hides from assistive tech without a label', () => {
    const { container } = render(<Icon name="coin" />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('role')).toBeNull();
  });

  it('exposes an accessible name when labelled', () => {
    const { getByRole } = render(<Icon name="coin" label="Coins" />);
    expect(getByRole('img', { name: 'Coins' })).toBeTruthy();
  });

  it('maps size to a modifier class', () => {
    const { container } = render(<Icon name="pin" size="lg" />);
    expect(container.querySelector('svg')?.getAttribute('class')).toContain('icon--lg');
  });

  it('serialises every icon for map rasterising', () => {
    for (const name of ICON_NAMES) expect(iconMarkup(name)).toMatch(/^<(path|circle|rect)/);
  });

  it('maps backend emoji to icon names', () => {
    expect(iconNameForEmoji('❄️')).toBe('snowflake');
    expect(iconNameForEmoji('')).toBeUndefined();
    expect(iconNameForEmoji('🦄')).toBeUndefined();
  });
});
