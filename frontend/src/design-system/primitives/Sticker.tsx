import React from 'react';

export interface StickerProps {
  /** Sticker color tone variant. */
  tone?: 'amber' | 'red';
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

/** Physical adhesive-label motif. */
export const Sticker: React.FC<StickerProps> = ({ tone = 'amber', children, className = '', style }) => {
  const toneClass = tone === 'red' ? 'sticker--alt' : '';

  return (
    <div className={`sticker ${toneClass} ${className}`.trim()} style={style}>
      {children}
    </div>
  );
};
