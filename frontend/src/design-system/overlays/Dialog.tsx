import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export interface DialogProps {
  open?: boolean;
  title?: string;
  children?: React.ReactNode;
  onClose?: () => void;
  className?: string;
  style?: React.CSSProperties;
}

export const Dialog: React.FC<DialogProps> = ({
  open = true,
  title,
  children,
  onClose,
  className = '',
  style,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;

    const node = dialogRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusables = (): HTMLElement[] =>
      node
        ? Array.from(
            node.querySelectorAll<HTMLElement>(
              'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
            )
          ).filter((el) => el.offsetParent !== null || el === document.activeElement)
        : [];

    // Move focus in, so Tab starts inside the dialog rather than behind it.
    if (node && !node.contains(document.activeElement)) {
      (focusables()[0] ?? node)?.focus();
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && onCloseRef.current) {
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !node) return;

      const items = focusables();
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;

      if (e.shiftKey && (active === first || !node.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !node.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    // The document scroller is .page-shell--doc, not <body> — lock whichever
    // ancestor is actually scrolling so the page behind cannot move.
    const scroller = document.querySelector<HTMLElement>('.page-shell--doc') ?? document.body;
    const originalOverflow = scroller.style.overflow;
    scroller.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      scroller.style.overflow = originalOverflow;
      previouslyFocused?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className="scrim" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title || 'Dialog'}
        className={`dialog ${className}`.trim()}
        onClick={(e) => e.stopPropagation()}
        tabIndex={-1}
        style={style}
      >
        {title && (
          <div className="dialog__header">
            <h2 className="dialog__title">{title}</h2>
            {onClose && (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={onClose}
                aria-label="Close dialog"
              >
                ✕
              </button>
            )}
          </div>
        )}
        <div className="dialog__body">{children}</div>
      </div>
    </div>,
    document.body
  );
};

