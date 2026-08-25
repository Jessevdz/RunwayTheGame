import React from 'react';

export interface EmptyProps {
  /** Large glyph above the heading. */
  icon?: React.ReactNode;
  title?: React.ReactNode;
  description?: React.ReactNode;
  /** Call-to-action slot, typically a single `<Button>`. */
  action?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

/** Dashed-border empty state for lists and grids that have nothing to show. */
export const Empty: React.FC<EmptyProps> = ({
  icon,
  title,
  description,
  action,
  className = '',
  style,
}) => {
  return (
    <div className={`empty ${className}`.trim()} style={style}>
      {icon && <div className="fs-10" aria-hidden="true">{icon}</div>}
      {title && <h4>{title}</h4>}
      {description && <p>{description}</p>}
      {action}
    </div>
  );
};
