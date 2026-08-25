import React from 'react';

export interface TextareaProps {
  label?: React.ReactNode;
  hint?: string;
  error?: string;
  placeholder?: string;
  rows?: number;
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  className?: string;
  style?: React.CSSProperties;
}

/** Multi-line textarea component styled with design system field tokens. */
export const Textarea: React.FC<TextareaProps> = ({
  label,
  hint,
  error,
  placeholder,
  rows = 3,
  value,
  onChange,
  className = '',
  style,
}) => {
  return (
    <div className={`field ${error ? 'field--error' : ''} ${className}`.trim()} style={style}>
      {label && <label className="field__label">{label}</label>}
      <textarea
        className="field__input"
        placeholder={placeholder}
        rows={rows}
        value={value ?? ''}
        onChange={onChange}
      />
      {error ? (
        <span className="field__error">{error}</span>
      ) : hint ? (
        <span className="hint">{hint}</span>
      ) : null}
    </div>
  );
};
