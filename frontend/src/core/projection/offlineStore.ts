import { generateUUID } from '../util/uuid';

export interface QueuedCapturePayload {
  gameId: string;
  waypointId: string;
  challengeId: string;
  photo: Blob;
  contentType: string;
  /** Location coordinates captured with the photo. */
  lat: number;
  lon: number;
  accuracyM: number;
  /** ISO timestamp recorded when the shutter fired. */
  clientCapturedAt: string;
}

export interface QueuedAction {
  id?: number;
  /** Client-side idempotency key preserved across retries. */
  idempotencyKey: string;
  type: 'capture';
  timestamp: string;
  payload: QueuedCapturePayload;
}

const DB_NAME = 'RunwayOfflineDB';
const STORE_NAME = 'action_queue';
const DB_VERSION = 2;

/** Generates a unique client-side UUID for action idempotency keys. */
export function generateIdempotencyKey(): string {
  return generateUUID();
}

let dbInstance: IDBDatabase | null = null;

// Open/Initialise DB
export function initDB(): Promise<IDBDatabase> {
  if (dbInstance) return Promise.resolve(dbInstance);

  return new Promise((resolve, reject) => {
    // Fallback if IndexedDB is not supported (e.g. in some server environments or old test suites)
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not supported in this environment'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      reject(new Error(`Failed to open IndexedDB database: ${request.error?.message}`));
    };

    request.onsuccess = () => {
      dbInstance = request.result;
      resolve(request.result);
    };

    request.onupgradeneeded = (_event) => {
      const db = request.result;
      let store: IDBObjectStore;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      } else {
        store = request.transaction!.objectStore(STORE_NAME);
      }
      if (!store.indexNames.contains('idempotencyKey')) {
        store.createIndex('idempotencyKey', 'idempotencyKey', { unique: true });
      }
    };
  });
}

/** Enqueues an offline action, deduplicating retries via idempotency key. */
export async function enqueueAction(action: Omit<QueuedAction, 'id'>): Promise<number> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.add(action);

    request.onsuccess = () => {
      resolve(request.result as number);
    };

    request.onerror = (event) => {
      if (request.error?.name === 'ConstraintError') {
        // Expected on a retried enqueue of the same command; swallow so the
        // transaction doesn't abort, then resolve to the existing row's id.
        event.preventDefault();
        const index = store.index('idempotencyKey');
        const lookup = index.get(action.idempotencyKey);
        lookup.onsuccess = () => resolve((lookup.result as QueuedAction)?.id as number);
        lookup.onerror = () => reject(new Error('Failed to look up existing queued action'));
        return;
      }
      reject(new Error(`Failed to enqueue action: ${request.error?.message}`));
    };
  });
}

// Get all actions in order
export async function getQueuedActions(): Promise<QueuedAction[]> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      resolve(request.result as QueuedAction[]);
    };

    request.onerror = () => {
      reject(new Error(`Failed to retrieve actions: ${request.error?.message}`));
    };
  });
}

// Dequeue action (remove by ID)
export async function dequeueAction(id: number): Promise<void> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(id);

    request.onsuccess = () => {
      resolve();
    };

    request.onerror = () => {
      reject(new Error(`Failed to delete action: ${request.error?.message}`));
    };
  });
}

// Clear all queued actions (useful for rollbacks/clearing states)
export async function clearQueue(): Promise<void> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.clear();

    request.onsuccess = () => {
      resolve();
    };

    request.onerror = () => {
      reject(new Error(`Failed to clear action queue: ${request.error?.message}`));
    };
  });
}

// Purges all queued actions belonging to a single game.
export async function purgeQueueForGame(gameId: string): Promise<void> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => {
      const rows = request.result as QueuedAction[];
      const targets = rows.filter((a) => a.payload.gameId === gameId);
      if (targets.length === 0) {
        resolve();
        return;
      }
      let remaining = targets.length;
      let failed = false;
      const finish = () => {
        remaining -= 1;
        if (remaining === 0) {
          if (failed) reject(new Error('Failed to purge queued actions'));
          else resolve();
        }
      };
      for (const row of targets) {
        if (row.id === undefined) {
          finish();
          continue;
        }
        const del = store.delete(row.id);
        del.onsuccess = finish;
        del.onerror = () => {
          failed = true;
          finish();
        };
      }
    };
    request.onerror = () => {
      reject(new Error('Failed to purge queued actions'));
    };
  });
}
