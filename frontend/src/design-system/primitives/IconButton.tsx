import React from 'react';

export interface IconButtonProps {
  icon: React.ReactNode;
  label: string;
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  className?: string;
  style?: React.CSSProperties;
}

export const IconButton: React.FC<IconButtonProps> = ({
  icon,
  label,
  variant = 'ghost',
  size = 'md',
  onClick,
  className = '',
  style,
}) => {
  const variantClass = variant === 'primary' ? 'btn--primary' : variant === 'secondary' ? 'btn--secondary' : 'btn--ghost';
  const sizeClass = size === 'sm' ? 'btn--sm' : size === 'lg' ? 'btn--lg' : '';

  return (
    <button
      type="button"
      className={`btn btn--icon ${variantClass} ${sizeClass} ${className}`.trim()}
      aria-label={label}
      title={label}
      onClick={onClick}
      style={style}
    >
      {icon}
    </button>
  );
};
