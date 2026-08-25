// Service worker update lifecycle manager for PWA updates.

type UpdateListener = (available: boolean) => void;

class UpdateManager {
  private listeners: Set<UpdateListener> = new Set();
  private waitingWorker: ServiceWorker | null = null;
  private available = false;
  private refreshing = false;

  public init() {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    if (!import.meta.env.PROD) return;

    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/sw.js')
        .then((registration) => {
          console.log('[PWA] Service Worker registered successfully:', registration.scope);

          if (registration.waiting && navigator.serviceWorker.controller) {
            this.setAvailable(registration.waiting);
          }

          registration.addEventListener('updatefound', () => {
            const newWorker = registration.installing;
            if (!newWorker) return;

            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed') {
                if (navigator.serviceWorker.controller) {
                  console.log('[PWA] New service worker version installed, waiting to be applied.');
                  this.setAvailable(newWorker);
                } else {
                  console.log('[PWA] Content cached for offline use.');
                }
              }
            });
          });
        })
        .catch((err) => {
          console.error('[PWA] Service Worker registration failed:', err);
        });
    });

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!this.refreshing) {
        this.refreshing = true;
        window.location.reload();
      }
    });
  }

  private setAvailable(worker: ServiceWorker) {
    this.waitingWorker = worker;
    this.available = true;
    this.listeners.forEach((l) => l(true));
  }

  public subscribe(listener: UpdateListener): () => void {
    this.listeners.add(listener);
    listener(this.available);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Applies the pending service worker update by posting a SKIP_WAITING message. */
  public applyUpdate() {
    this.waitingWorker?.postMessage({ type: 'SKIP_WAITING' });
  }
}

export const updateManager = new UpdateManager();
