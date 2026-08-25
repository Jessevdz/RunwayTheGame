import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  enqueueAction,
  getQueuedActions,
  dequeueAction,
  clearQueue,
  purgeQueueForGame,
  generateIdempotencyKey
} from './offlineStore';
import { forgetRace } from '../game/raceSession';

function constraintError(): Error & { name: string } {
  const e = new Error('Constraint failed') as Error & { name: string };
  e.name = 'ConstraintError';
  return e;
}

class FakeIDBRequest {
  result: unknown = undefined;
  error: Error | null = null;
  onerror: ((ev: { preventDefault(): void }) => void) | null = null;
  onsuccess: (() => void) | null = null;
  onupgradeneeded: ((ev: IDBVersionChangeEvent) => void) | null = null;

  resolve(value: unknown): FakeIDBRequest {
    this.result = value;
    queueMicrotask(() => this.onsuccess && this.onsuccess());
    return this;
  }

  reject(err: Error): FakeIDBRequest {
    this.error = err;
    queueMicrotask(() => this.onerror && this.onerror({ preventDefault() {} }));
    return this;
  }
}

class FakeObjectStore {
  name: string;
  keyPath: string | undefined;
  autoIncrement: boolean;
  rows: Record<string, unknown>[] = [];
  nextId = 1;
  private nameSet = new Set<string>();
  indexNames: { contains(n: string): boolean };
  private indexes: Record<string, Map<string, unknown>> = {};

  constructor(
    name: string,
    keyPath: string | undefined,
    autoIncrement: boolean = false
  ) {
    this.name = name;
    this.keyPath = keyPath;
    this.autoIncrement = autoIncrement;
    this.indexNames = { contains: (n) => this.nameSet.has(n) };
  }

  createIndex(name: string, _keyPath: string): void {
    this.nameSet.add(name);
    this.indexes[name] = new Map();
  }

  add(value: Record<string, unknown>): FakeIDBRequest {
    const req = new FakeIDBRequest();
    const row = { ...value };
    const ik = row['idempotencyKey'] as string | undefined;
    for (const map of Object.values(this.indexes)) {
      if (ik !== undefined && map.has(ik)) return req.reject(constraintError());
    }
    if (this.keyPath && this.autoIncrement) row[this.keyPath] = this.nextId++;
    this.rows.push(row);
    for (const map of Object.values(this.indexes)) {
      if (ik !== undefined) map.set(ik, row);
    }
    return req.resolve(row[this.keyPath as string]);
  }

  getAll(): FakeIDBRequest {
    const req = new FakeIDBRequest();
    return req.resolve([...this.rows]);
  }

  delete(id: number): FakeIDBRequest {
    const req = new FakeIDBRequest();
    const deleted = this.rows.find((r) => (r['id'] as number) === id);
    if (deleted) {
      const ik = deleted['idempotencyKey'] as string | undefined;
      for (const map of Object.values(this.indexes)) {
        if (ik !== undefined) map.delete(ik);
      }
    }
    this.rows = this.rows.filter((r) => (r['id'] as number) !== id);
    return req.resolve(undefined);
  }

  clear(): FakeIDBRequest {
    const req = new FakeIDBRequest();
    this.rows = [];
    this.nextId = 1;
    for (const map of Object.values(this.indexes)) map.clear();
    return req.resolve(undefined);
  }

  index(name: string): { get(key: string): FakeIDBRequest } {
    return { get: (key) => new FakeIDBRequest().resolve(this.indexes[name]?.get(key)) };
  }
}

class FakeDB {
  name: string;
  stores: Record<string, FakeObjectStore> = {};
  private storeNameSet = new Set<string>();
  objectStoreNames: { contains(n: string): boolean };

  constructor(name: string) {
    this.name = name;
    this.objectStoreNames = { contains: (n) => this.storeNameSet.has(n) };
  }

  createObjectStore(name: string, opts?: { keyPath?: string; autoIncrement?: boolean }): FakeObjectStore {
    const s = new FakeObjectStore(name, opts?.keyPath, opts?.autoIncrement ?? false);
    this.stores[name] = s;
    this.storeNameSet.add(name);
    return s;
  }

  transaction(storeName: string, _mode?: string): { objectStore(name: string): FakeObjectStore } {
    return { objectStore: () => this.stores[storeName] };
  }
}

function installFakeIndexedDB(): void {
  const open = (name: string, _version: number) => {
    const req = new FakeIDBRequest();
    const db = new FakeDB(name);
    queueMicrotask(() => {
      req.result = db;
      if (req.onupgradeneeded) req.onupgradeneeded({ target: req } as unknown as IDBVersionChangeEvent);
      req.resolve(db);
    });
    return req;
  };
  vi.stubGlobal('indexedDB', { open } as unknown as IDBFactory);
}

describe('offlineStore and action queue lifecycle', () => {
  beforeEach(async () => {
    localStorage.clear();
    installFakeIndexedDB();
    await clearQueue();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('generates unique idempotency keys', () => {
    const k1 = generateIdempotencyKey();
    const k2 = generateIdempotencyKey();
    expect(k1).toBeTruthy();
    expect(k2).toBeTruthy();
    expect(k1).not.toBe(k2);
  });

  it('enqueues, retrieves, and dequeues capture actions', async () => {
    const photo = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });
    const id = await enqueueAction({
      idempotencyKey: 'key-1',
      type: 'capture',
      timestamp: '2026-08-20T10:00:00Z',
      payload: {
        gameId: 'game-1',
        waypointId: 'wp-1',
        challengeId: 'ch-1',
        photo,
        contentType: 'image/jpeg',
        lat: 51.2,
        lon: 4.4,
        accuracyM: 5,
        clientCapturedAt: '2026-08-20T10:00:00Z'
      }
    });

    expect(id).toBe(1);

    const queued = await getQueuedActions();
    expect(queued).toHaveLength(1);
    expect(queued[0].payload.gameId).toBe('game-1');
    expect(queued[0].payload.waypointId).toBe('wp-1');

    await dequeueAction(id);
    const remaining = await getQueuedActions();
    expect(remaining).toHaveLength(0);
  });

  it('deduplicates identical enqueue attempts via idempotency key', async () => {
    const photo = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });
    const action = {
      idempotencyKey: 'dup-key',
      type: 'capture' as const,
      timestamp: '2026-08-20T10:00:00Z',
      payload: {
        gameId: 'game-1',
        waypointId: 'wp-1',
        challengeId: 'ch-1',
        photo,
        contentType: 'image/jpeg',
        lat: 51.2,
        lon: 4.4,
        accuracyM: 5,
        clientCapturedAt: '2026-08-20T10:00:00Z'
      }
    };

    const firstId = await enqueueAction(action);
    const secondId = await enqueueAction(action);

    expect(firstId).toBe(1);
    expect(secondId).toBe(1);

    const queued = await getQueuedActions();
    expect(queued).toHaveLength(1);
  });

  it('purges queued actions only for the specified gameId', async () => {
    const photo = new Blob([new Uint8Array([1])], { type: 'image/jpeg' });
    await enqueueAction({
      idempotencyKey: 'g1-k1',
      type: 'capture',
      timestamp: '2026-08-20T10:00:00Z',
      payload: {
        gameId: 'game-target',
        waypointId: 'wp-1',
        challengeId: 'ch-1',
        photo,
        contentType: 'image/jpeg',
        lat: 51.2,
        lon: 4.4,
        accuracyM: 5,
        clientCapturedAt: '2026-08-20T10:00:00Z'
      }
    });

    await enqueueAction({
      idempotencyKey: 'g2-k1',
      type: 'capture',
      timestamp: '2026-08-20T10:00:00Z',
      payload: {
        gameId: 'game-other',
        waypointId: 'wp-2',
        challengeId: 'ch-2',
        photo,
        contentType: 'image/jpeg',
        lat: 51.3,
        lon: 4.5,
        accuracyM: 5,
        clientCapturedAt: '2026-08-20T10:00:00Z'
      }
    });

    await purgeQueueForGame('game-target');

    const remaining = await getQueuedActions();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].payload.gameId).toBe('game-other');

    await clearQueue();
    expect(await getQueuedActions()).toHaveLength(0);
  });

  it('forgetRace purges offline queued captures for that race', async () => {
    const photo = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/jpeg' });
    await enqueueAction({
      idempotencyKey: 'ik-race-1',
      type: 'capture',
      timestamp: '2026-08-20T10:00:00Z',
      payload: {
        gameId: 'race-to-forget',
        waypointId: 'wp-1',
        challengeId: 'ch-1',
        photo,
        contentType: 'image/jpeg',
        lat: 51.5,
        lon: -0.12,
        accuracyM: 4,
        clientCapturedAt: '2026-08-20T10:00:00Z'
      }
    });

    const before = await getQueuedActions();
    expect(before).toHaveLength(1);

    await forgetRace('race-to-forget');

    const after = await getQueuedActions();
    expect(after).toHaveLength(0);
  });
});
