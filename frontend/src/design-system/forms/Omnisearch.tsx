import React from 'react';

export interface OmnisearchProps {
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSubmit?: (value: string) => void;
  placeholder?: string;
  /** Accessible name — the input carries no visible label. */
  label?: string;
  /** Keyboard hint rendered in the trailing kbd chip. */
  shortcut?: string;
  icon?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

/** Pill-shaped global search field with a keyboard-shortcut affordance. */
export const Omnisearch: React.FC<OmnisearchProps> = ({
  value,
  onChange,
  onSubmit,
  placeholder = 'Search…',
  label = 'Search',
  shortcut = '/',
  icon = '⌕',
  className = '',
  style,
}) => {
  return (
    <div className={`omnisearch ${className}`.trim()} style={style}>
      <span aria-hidden="true">{icon}</span>
      <input
        type="search"
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && onSubmit) onSubmit(e.currentTarget.value);
        }}
      />
      {shortcut && <kbd>{shortcut}</kbd>}
    </div>
  );
};
