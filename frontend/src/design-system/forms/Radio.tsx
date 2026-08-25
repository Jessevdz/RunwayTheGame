import React from 'react';

export interface RadioProps {
  name?: string;
  label?: string;
  checked?: boolean;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  className?: string;
  style?: React.CSSProperties;
}

export const Radio: React.FC<RadioProps> = ({
  name,
  label,
  checked = false,
  onChange,
  className = '',
  style,
}) => {
  return (
    <label className={`radio ${className}`.trim()} style={style}>
      <input type="radio" name={name} checked={checked} onChange={onChange} />
      {label && <span>{label}</span>}
    </label>
  );
};
