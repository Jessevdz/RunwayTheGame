import React from 'react';
import './icons.css';
import { ICON_SHAPES, ICON_STROKE, ICON_VIEWBOX, type IconName, type IconShape } from './iconShapes';

export type { IconName } from './iconShapes';

export interface IconProps {
  name: IconName;
  /** Token-mapped size; omit to follow the surrounding font size. */
  size?: 'sm' | 'md' | 'lg';
  /** Accessible name; icons are hidden from assistive tech without it. */
  label?: string;
  className?: string;
  style?: React.CSSProperties;
}

/** Wayfinding icon drawn on a 24-unit grid with a 2.2 stroke in currentColor. */
export const Icon: React.FC<IconProps> = ({ name, size, label, className = '', style }) => {
  const classes = ['ic', 'icon', size ? `icon--${size}` : '', className].filter(Boolean).join(' ');
  const a11y = label
    ? ({ role: 'img', 'aria-label': label } as const)
    : ({ 'aria-hidden': true, focusable: 'false' } as const);

  return (
    <svg
      viewBox={`0 0 ${ICON_VIEWBOX} ${ICON_VIEWBOX}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={ICON_STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={classes}
      style={style}
      data-icon={name}
      {...a11y}
    >
      {(ICON_SHAPES[name] as readonly IconShape[]).map((shape, i) => {
        if ('d' in shape) return <path key={i} d={shape.d} />;
        if ('cx' in shape) return <circle key={i} cx={shape.cx} cy={shape.cy} r={shape.r} />;
        return <rect key={i} x={shape.x} y={shape.y} width={shape.width} height={shape.height} rx={shape.rx} />;
      })}
    </svg>
  );
};
