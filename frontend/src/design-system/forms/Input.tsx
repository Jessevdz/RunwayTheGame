import React, { useId } from 'react';

export interface InputProps {
  label?: React.ReactNode;
  hint?: string;
  error?: string;
  type?: string;
  placeholder?: string;
  value?: string | number;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  /** Submit-on-Enter. A field outside a <form> has no implicit submit, and the
   *  Go key on a phone keyboard is the shortest path to the action. */
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  /** For fields that exist to be read and copied, like a share link. Without it
   *  React logs a controlled-input error for every value-without-onChange. */
  readOnly?: boolean;
  disabled?: boolean;
  maxLength?: number;
  /** Mobile keyboard input hints. */
  inputMode?: 'text' | 'numeric' | 'decimal' | 'tel' | 'search' | 'email' | 'url' | 'none';
  autoCapitalize?: 'off' | 'none' | 'on' | 'sentences' | 'words' | 'characters';
  autoComplete?: string;
  autoCorrect?: 'on' | 'off';
  spellCheck?: boolean;
  enterKeyHint?: 'enter' | 'done' | 'go' | 'next' | 'previous' | 'search' | 'send';
  autoFocus?: boolean;
  className?: string;
  style?: React.CSSProperties;
  /** Escape hatch for a caller that has its own id scheme. */
  id?: string;
}

export const Input: React.FC<InputProps> = ({
  label,
  hint,
  error,
  type = 'text',
  placeholder,
  value,
  onChange,
  onKeyDown,
  readOnly,
  disabled,
  maxLength,
  inputMode,
  autoCapitalize,
  autoComplete,
  autoCorrect,
  spellCheck,
  enterKeyHint,
  autoFocus,
  className = '',
  style,
  id,
}) => {
  // Connects label and input with accessible ID mapping.
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const describedById = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;

  return (
    <div className={`field ${error ? 'field--error' : ''} ${className}`.trim()} style={style}>
      {label && (
        <label className="field__label" htmlFor={inputId}>
          {label}
        </label>
      )}
      <input
        id={inputId}
        type={type}
        className="field__input"
        placeholder={placeholder}
        value={value ?? ''}
        onChange={onChange}
        onKeyDown={onKeyDown}
        readOnly={readOnly}
        disabled={disabled}
        maxLength={maxLength}
        inputMode={inputMode}
        autoCapitalize={autoCapitalize}
        autoComplete={autoComplete}
        autoCorrect={autoCorrect}
        spellCheck={spellCheck}
        enterKeyHint={enterKeyHint}
        autoFocus={autoFocus}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedById}
      />
      {error ? (
        <span className="field__error" id={describedById} role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="hint" id={describedById}>
          {hint}
        </span>
      ) : null}
    </div>
  );
};
