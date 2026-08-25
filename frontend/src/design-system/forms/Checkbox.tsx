import React from 'react';

export interface CheckboxProps {
  label?: string;
  checked?: boolean;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  className?: string;
  style?: React.CSSProperties;
}

export const Checkbox: React.FC<CheckboxProps> = ({
  label,
  checked = false,
  onChange,
  className = '',
  style,
}) => {
  return (
    <label className={`checkbox ${className}`.trim()} style={style}>
      <input type="checkbox" checked={checked} onChange={onChange} />
      {label && <span>{label}</span>}
    </label>
  );
};
