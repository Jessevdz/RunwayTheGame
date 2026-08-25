import React from 'react';

export interface TabItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  badge?: number;
}

export interface TabsProps {
  items: TabItem[];
  active: string;
  onChange: (id: string) => void;
  className?: string;
  style?: React.CSSProperties;
}

export const Tabs: React.FC<TabsProps> = ({
  items,
  active,
  onChange,
  className = '',
  style,
}) => {
  return (
    <div className={`tabs ${className}`.trim()} style={style} role="tablist">
      {items.map((item) => {
        const isActive = item.id === active;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={`tab ${isActive ? 'tab--active' : ''}`.trim()}
            onClick={() => onChange(item.id)}
          >
            {item.icon && <span className="tab__icon">{item.icon}</span>}
            <span>{item.label}</span>
            {typeof item.badge === 'number' && item.badge > 0 && (
              <span className="tab__badge">{item.badge}</span>
            )}
          </button>
        );
      })}
    </div>
  );
};
