import { getQueuedActions, dequeueAction } from './offlineStore';
import type { QueuedAction } from './offlineStore';
import { loadTeamSession } from '../game/teamSession';
import { presignUpload, uploadToPresignedUrl, submitChallengeEvidence, ApiError } from '../api/client';

export type SyncState = 'online' | 'offline' | 'syncing';

type SyncStateListener = (state: SyncState) => void;
type QueueCountListener = (count: number) => void;

class SyncEngine {
  private currentState: SyncState = 'online';
  private listeners: Set<SyncStateListener> = new Set();
  private queueListeners: Set<QueueCountListener> = new Set();
  private isProcessing = false;

  constructor() {
    if (typeof window !== 'undefined') {
      this.currentState = navigator.onLine ? 'online' : 'offline';

      window.addEventListener('online', () => this.handleNetworkChange(true));
      window.addEventListener('offline', () => this.handleNetworkChange(false));
    }
    this.refreshQueueCount();
  }

  public subscribe(listener: SyncStateListener): () => void {
    this.listeners.add(listener);
    listener(this.currentState);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Subscribes to the count of queued offline actions. */
  public subscribeQueueCount(listener: QueueCountListener): () => void {
    this.queueListeners.add(listener);
    getQueuedActions().then((a) => listener(a.length)).catch(() => listener(0));
    return () => {
      this.queueListeners.delete(listener);
    };
  }

  private async refreshQueueCount() {
    try {
      const actions = await getQueuedActions();
      this.queueListeners.forEach((l) => l(actions.length));
    } catch {
      // IndexedDB unavailable
    }
  }

  public getSyncState(): SyncState {
    return this.currentState;
  }

  private setState(state: SyncState) {
    if (this.currentState !== state) {
      this.currentState = state;
      this.listeners.forEach((l) => l(state));
    }
  }

  private handleNetworkChange(isOnline: boolean) {
    if (isOnline) {
      this.setState('online');
      this.startSync();
    } else {
      this.setState('offline');
    }
  }

  /** Triggers a sync attempt if the network is online. */
  public triggerSync() {
    if (navigator.onLine) this.startSync();
  }

  /** Flushes queued offline actions to the server. */
  public async startSync(): Promise<void> {
    if (this.isProcessing) return;

    const actions = await getQueuedActions();
    if (actions.length === 0) {
      this.setState('online');
      return;
    }

    this.isProcessing = true;
    this.setState('syncing');

    try {
      for (const action of actions) {
        await this.processAction(action);
      }
    } catch (err: any) {
      console.error('[SyncEngine] Sync failed midway:', err.message);
    } finally {
      this.isProcessing = false;
      this.setState(navigator.onLine ? 'online' : 'offline');
      this.refreshQueueCount();
    }
  }

  /** Sends a single queued capture action to the backend API. */
  private async processAction(action: QueuedAction): Promise<void> {
    const { gameId, waypointId, challengeId, photo, contentType, lat, lon, accuracyM, clientCapturedAt } =
      action.payload;

    const session = loadTeamSession(gameId);
    if (!session) {
      // The capability token is not persisted in the queue; drop actions with no session.
      console.warn(`[SyncEngine] No team session for ${gameId}; dropping queued capture ${action.idempotencyKey}`);
      if (action.id) await dequeueAction(action.id);
      return;
    }
    const teamToken = session.teamToken;

    try {
      const { upload_url, blob_ref } = await presignUpload(gameId, {
        team_token: teamToken,
        content_type: contentType
      });
      await uploadToPresignedUrl(upload_url, photo, contentType);
      await submitChallengeEvidence(gameId, {
        team_token: teamToken,
        road_id: waypointId,
        challenge_id: challengeId,
        blob_ref,
        lat,
        lon,
        accuracy_m: accuracyM,
        idempotency_key: action.idempotencyKey,
        client_captured_at: clientCapturedAt
      });
    } catch (err) {
      if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
        // Drop permanently rejected action to avoid blocking queue processing.
        console.warn(`[SyncEngine] Queued capture ${action.idempotencyKey} rejected by server (${err.status}): ${err.message}`);
      } else {
        throw err;
      }
    }

    if (action.id) {
      await dequeueAction(action.id);
    }
  }
}

export const syncEngine = new SyncEngine();
