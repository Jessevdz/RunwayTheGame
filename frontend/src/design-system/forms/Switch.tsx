import React from 'react';

export interface SwitchProps {
  label?: string;
  checked?: boolean;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  className?: string;
  style?: React.CSSProperties;
}

export const Switch: React.FC<SwitchProps> = ({
  label,
  checked = false,
  onChange,
  className = '',
  style,
}) => {
  return (
    <label className={`switch ${className}`.trim()} style={style}>
      <input type="checkbox" checked={checked} onChange={onChange} />
      {label && <span>{label}</span>}
    </label>
  );
};
