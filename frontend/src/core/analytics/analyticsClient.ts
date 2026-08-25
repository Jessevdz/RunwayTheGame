import { getServerConfig } from '../api/client';
import { generateUUID } from '../util/uuid';
import type { AnalyticsEventName, AnalyticsProps } from './events';
import { sendBatch } from './transport';
import type { QueuedEvent } from './transport';

/** In-memory analytics client that queues and flushes metrics. */

const FLUSH_INTERVAL_MS = 10_000;
/** Maximum number of events allowed per batch request. */
const MAX_BATCH = 25;
/** A hard ceiling on memory if the server is unreachable for a long session. */
const MAX_QUEUE = 200;
/** Consecutive transport failure threshold before disabling client. */
const MAX_FAILURES = 3;

class AnalyticsClient {
  private readonly sessionId = generateUUID();
  private queue: QueuedEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Recording status; false disables analytics collection. */
  private enabled: boolean | undefined = undefined;
  private failures = 0;
  private dead = false;
  private started = false;

  /** Initializes privacy checks, remote config, and unload flush handlers. */
  public init(): void {
    if (this.started || typeof window === 'undefined') return;
    this.started = true;

    // Respect browser Do Not Track and Global Privacy Control flags.
    const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
    if (nav.doNotTrack === '1' || nav.globalPrivacyControl) {
      this.dead = true;
      return;
    }

    // Verify server config before enabling event queueing.
    getServerConfig()
      .then((cfg) => {
        this.enabled = cfg.analytics === true;
        if (!this.enabled) this.discard();
      })
      .catch(() => {
        this.enabled = false;
        this.discard();
      });

    // Flush remaining events when the document is hidden or unloaded.
    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.flush(true);
    });
    window.addEventListener('pagehide', () => this.flush(true));
  }

  public track(name: AnalyticsEventName, props?: AnalyticsProps): void {
    try {
      if (this.dead || this.enabled === false) return;
      if (this.queue.length >= MAX_QUEUE) {
        // Drop oldest event when maximum queue length is reached.
        this.queue.shift();
      }
      this.queue.push(props && Object.keys(props).length > 0 ? { name, props } : { name });
      if (this.queue.length >= MAX_BATCH) {
        this.flush();
      } else {
        this.schedule();
      }
    } catch {
      // Swallow errors to avoid interrupting user flows.
    }
  }

  /** Flushes queued analytics events, using Beacon API during page unloads. */
  public flush(duringUnload = false): void {
    try {
      this.stopTimer();
      if (this.dead || this.enabled !== true || this.queue.length === 0) return;

      const batch = this.queue.splice(0, MAX_BATCH);
      void sendBatch(this.sessionId, batch, duringUnload).then((result) => {
        if (result === 'ok') {
          this.failures = 0;
          // Schedule remaining queued events.
          if (this.queue.length > 0) this.schedule();
          return;
        }
        if (result === 'refused') {
          // Stop tracking permanently if the server rejects event payloads.
          this.dead = true;
          this.discard();
          return;
        }
        // Track consecutive delivery failures to permanently disable client if threshold is reached.
        this.failures += 1;
        if (this.failures >= MAX_FAILURES) {
          this.dead = true;
          this.discard();
        }
      });
    } catch {
      // Swallowed silently.
    }
  }

  private schedule(): void {
    if (this.timer !== null || this.dead || this.enabled === false) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, FLUSH_INTERVAL_MS);
  }

  private stopTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private discard(): void {
    this.queue.length = 0;
    this.stopTimer();
  }
}

export const analytics = new AnalyticsClient();
