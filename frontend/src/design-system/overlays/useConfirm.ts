import { createContext, useCallback, useContext, type ReactNode } from 'react';

export interface ConfirmOptions {
  title?: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Styles the confirm action as destructive. */
  danger?: boolean;
  /** Drops the cancel action, turning the sheet into an alert. */
  hideCancel?: boolean;
}

export type Ask = (options: ConfirmOptions) => Promise<boolean>;

export const ConfirmContext = createContext<Ask | null>(null);

const nativeConfirm: Ask = async (options) => {
  const text = [options.title, typeof options.message === 'string' ? options.message : '']
    .filter(Boolean)
    .join('\n\n');
  if (options.hideCancel) {
    window.alert(text);
    return true;
  }
  return window.confirm(text);
};

/** Returns confirm(options) resolving true on confirm and false on cancel, dismiss or Escape; falls back to window.confirm outside a ConfirmProvider. */
export const useConfirm = (): Ask => useContext(ConfirmContext) ?? nativeConfirm;

/** Returns alert(options) resolving once the sheet is acknowledged. */
export const useAlert = (): ((options: Omit<ConfirmOptions, 'hideCancel' | 'danger'>) => Promise<void>) => {
  const confirm = useConfirm();
  return useCallback(
    async (options) => {
      await confirm({ confirmLabel: 'OK', ...options, hideCancel: true });
    },
    [confirm]
  );
};
