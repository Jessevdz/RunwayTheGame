import React from 'react';

export interface SelectProps {
  label?: React.ReactNode;
  hint?: string;
  value?: string | number;
  onChange?: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export const Select: React.FC<SelectProps> = ({
  label,
  hint,
  value,
  onChange,
  children,
  className = '',
  style,
}) => {
  return (
    <div className={`field ${className}`.trim()} style={style}>
      {label && <label className="field__label">{label}</label>}
      <select className="field__select" value={value} onChange={onChange}>
        {children}
      </select>
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
};
