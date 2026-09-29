import { useSyncExternalStore } from 'react';

export type ToastTone = 'gold' | 'rust' | 'moss' | 'crimson' | 'neutral';

export interface ToastOptions {
  tone?: ToastTone;
  /** Milliseconds before auto-dismiss; 0 keeps the toast until dismissed. */
  duration?: number;
}

export interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
  duration: number;
}

export const DEFAULT_TOAST_DURATION = 4000;

/** Toasts kept on screen at once; the oldest is dropped past this. */
export const MAX_VISIBLE_TOASTS = 3;

let items: readonly ToastItem[] = [];
let nextId = 1;
const timers = new Map<number, ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((listener) => listener());

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getSnapshot = () => items;

/** Removes a toast and cancels its timer. */
export const dismissToast = (id: number) => {
  const timer = timers.get(id);
  if (timer) clearTimeout(timer);
  timers.delete(id);
  if (!items.some((item) => item.id === id)) return;
  items = items.filter((item) => item.id !== id);
  emit();
};

/** Shows a toast and returns its id. */
export const showToast = (message: string, options: ToastOptions = {}): number => {
  const id = nextId++;
  const item: ToastItem = {
    id,
    tone: options.tone ?? 'neutral',
    message,
    duration: options.duration ?? DEFAULT_TOAST_DURATION,
  };
  const next = [...items, item];
  const dropped = next.length > MAX_VISIBLE_TOASTS ? next.slice(0, next.length - MAX_VISIBLE_TOASTS) : [];
  dropped.forEach((old) => {
    const timer = timers.get(old.id);
    if (timer) clearTimeout(timer);
    timers.delete(old.id);
  });
  items = next.slice(dropped.length);
  if (item.duration > 0) {
    timers.set(id, setTimeout(() => dismissToast(id), item.duration));
  }
  emit();
  return id;
};

/** Clears every toast; mainly for tests and route changes. */
export const clearToasts = () => {
  timers.forEach((timer) => clearTimeout(timer));
  timers.clear();
  items = [];
  emit();
};

/** Reads the live toast list. */
export const useToasts = (): readonly ToastItem[] => useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

const toastApi = { show: showToast, dismiss: dismissToast, clear: clearToasts };

/** Imperative toast helpers, stable across renders. */
export const useToast = () => toastApi;
