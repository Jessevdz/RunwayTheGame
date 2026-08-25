import React from 'react';

export interface LinkButtonProps {
  href: string;
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  icon?: React.ReactNode;
  /** Opens in a new tab and adds the matching rel. */
  external?: boolean;
  title?: string;
  'aria-label'?: string;
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

/** Anchor element styled visually as a button for navigation links. */
export const LinkButton: React.FC<LinkButtonProps> = ({
  href,
  variant = 'secondary',
  size = 'md',
  icon,
  external = false,
  title,
  'aria-label': ariaLabel,
  children,
  className = '',
  style,
}) => {
  const variantClass =
    variant === 'primary' ? 'btn--primary' : variant === 'secondary' ? 'btn--secondary' : 'btn--ghost';
  const sizeClass = size === 'sm' ? 'btn--sm' : size === 'lg' ? 'btn--lg' : '';

  return (
    <a
      href={href}
      className={`btn ${variantClass} ${sizeClass} ${className}`.trim()}
      title={title}
      aria-label={ariaLabel}
      target={external ? '_blank' : undefined}
      rel={external ? 'noopener noreferrer' : undefined}
      style={style}
    >
      {icon && <span className="btn__icon">{icon}</span>}
      {children && <span>{children}</span>}
    </a>
  );
};
