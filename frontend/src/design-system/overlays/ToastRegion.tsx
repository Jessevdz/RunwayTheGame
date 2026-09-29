import React from 'react';
import { Toast } from './Toast';
import { dismissToast, useToasts, type ToastItem } from './toastStore';

export interface ToastRegionProps {
  /** Top keeps toasts clear of bottom actions; bottom is for screens with no bottom chrome. */
  position?: 'top' | 'bottom';
  className?: string;
  style?: React.CSSProperties;
}

const isUrgent = (item: ToastItem) => item.tone === 'crimson' || item.tone === 'rust';

const renderItem = (item: ToastItem) => (
  <Toast key={item.id} tone={item.tone} className="toast-region__toast">
    <span className="toast-region__message">{item.message}</span>
    <button
      type="button"
      className="toast-region__dismiss"
      aria-label="Dismiss notification"
      onClick={() => dismissToast(item.id)}
    >
      <span aria-hidden="true">&times;</span>
    </button>
  </Toast>
);

/** Fixed-position stack of announced toasts; mount it once near the app root. */
export const ToastRegion: React.FC<ToastRegionProps> = ({ position = 'top', className = '', style }) => {
  const items = useToasts();
  return (
    <div
      className={`toast-region toast-region--${position} ${className}`.trim()}
      style={style}
      role="region"
      aria-label="Notifications"
    >
      <div className="toast-region__stack" role="status" aria-live="polite" aria-atomic="false">
        {items.filter((item) => !isUrgent(item)).map(renderItem)}
      </div>
      <div className="toast-region__stack" role="alert" aria-live="assertive" aria-atomic="false">
        {items.filter(isUrgent).map(renderItem)}
      </div>
    </div>
  );
};
