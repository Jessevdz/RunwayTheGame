import React from 'react';

export interface TagProps {
  children?: React.ReactNode;
  onRemove?: () => void;
  className?: string;
  style?: React.CSSProperties;
}

export const Tag: React.FC<TagProps> = ({
  children,
  onRemove,
  className = '',
  style,
}) => {
  return (
    <span className={`chip ${className}`.trim()} style={style}>
      <span>{children}</span>
      {onRemove && (
        <button
          type="button"
          className="chip__remove"
          onClick={onRemove}
          aria-label="Remove tag"
        >
          ×
        </button>
      )}
    </span>
  );
};
