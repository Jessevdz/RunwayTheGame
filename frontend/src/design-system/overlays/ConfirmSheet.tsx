import React, { useCallback, useRef, useState } from 'react';
import { Button } from '../primitives/Button';
import { Dialog } from './Dialog';
import { ConfirmContext, type Ask, type ConfirmOptions } from './useConfirm';

export interface ConfirmSheetProps {
  open?: boolean;
  title?: string;
  children?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  hideCancel?: boolean;
  onConfirm?: () => void;
  onCancel?: () => void;
}

/** Bottom-sheet confirmation with two full-width, thumb-sized actions. */
export const ConfirmSheet: React.FC<ConfirmSheetProps> = ({
  open = true,
  title = 'Are you sure?',
  children,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  hideCancel = false,
  onConfirm,
  onCancel,
}) => (
  <Dialog
    open={open}
    presentation="sheet"
    title={title}
    onClose={onCancel}
    className={`confirm-sheet${danger ? ' confirm-sheet--danger' : ''}`}
  >
    {children && <div className="confirm-sheet__message">{children}</div>}
    <div className="confirm-sheet__actions">
      <Button variant="primary" size="lg" onClick={onConfirm}>
        {confirmLabel}
      </Button>
      {!hideCancel && (
        <Button variant="secondary" size="lg" onClick={onCancel}>
          {cancelLabel}
        </Button>
      )}
    </div>
  </Dialog>
);

interface Pending {
  options: ConfirmOptions;
  resolve: (value: boolean) => void;
}

/** Hosts the confirm sheet for useConfirm; mount once near the app root. */
export const ConfirmProvider: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);

  const settle = useCallback((value: boolean) => {
    pendingRef.current?.resolve(value);
    pendingRef.current = null;
    setPending(null);
  }, []);

  const ask = useCallback<Ask>((options) => {
    pendingRef.current?.resolve(false);
    return new Promise<boolean>((resolve) => {
      const next = { options, resolve };
      pendingRef.current = next;
      setPending(next);
    });
  }, []);

  const options = pending?.options;

  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      <ConfirmSheet
        open={!!pending}
        title={options?.title}
        confirmLabel={options?.confirmLabel}
        cancelLabel={options?.cancelLabel}
        danger={options?.danger}
        hideCancel={options?.hideCancel}
        onConfirm={() => settle(true)}
        onCancel={() => settle(false)}
      >
        {options?.message}
      </ConfirmSheet>
    </ConfirmContext.Provider>
  );
};
