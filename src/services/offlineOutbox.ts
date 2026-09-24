import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { useState, useEffect } from 'react';
import { doc, setDoc, updateDoc, deleteDoc, Timestamp } from 'firebase/firestore';
import { db } from './firebase';

// ── Types ─────────────────────────────────────────────────────────────────────

export type PayloadOp = 'setDoc' | 'updateDoc' | 'deleteDoc';

/**
 * A verbatim-replay entry. The op + data are serialized to AsyncStorage and
 * replayed exactly as queued. serverTimestamp() sentinels are captured as the
 * client-side time at enqueue — slightly less precise than a true server
 * timestamp, but correct for an offline write that may flush hours later.
 *
 * Usage:
 *   enqueuePayload('setDoc', `venues/${venueId}/requests/${reqId}`, {
 *     status: 'pending',
 *     createdAt: serverTimestamp(),   // serialized to client time, fine for offline
 *   });
 */
export interface PayloadEntry {
  kind: 'payload';
  id: string;
  op: PayloadOp;
  /** Firestore path segments joined with '/': 'venues/v1/requests/r1' */
  path: string;
  data?: Record<string, unknown>;
  options?: { merge?: boolean };
  queuedAt: number;
}

/**
 * A function-reference entry. At flush time the named function is called with
 * the original params. Use this for writes that read current Firestore state
 * before deciding what to write (batches, transactions, multi-step sequences).
 *
 * Params MUST be JSON-serializable — no Firestore sentinels or class instances.
 *
 * Usage:
 *   // Register once (module load or component mount):
 *   registerOperation('doTransfer', ({ fromBar, toBar, productId, qty }) =>
 *     runTransferTransaction(fromBar, toBar, productId, qty));
 *
 *   // Enqueue when needed:
 *   enqueueOperation('doTransfer', { fromBar: 'bar1', toBar: 'bar2', productId: 'p1', qty: 6 });
 */
export interface OperationEntry {
  kind: 'operation';
  id: string;
  name: string;
  params: unknown;
  queuedAt: number;
}

export type OutboxEntry = PayloadEntry | OperationEntry;

// ── Constants ─────────────────────────────────────────────────────────────────

const STORAGE_KEY = '@tallyup/offlineOutbox';

// ── Module state ──────────────────────────────────────────────────────────────

const registry = new Map<string, (params: unknown) => Promise<void>>();
const listeners = new Set<() => void>();

let _count = 0;
let _initialized = false;

// All queue mutations (enqueue, flush, init-load) are chained on this promise
// to prevent concurrent AsyncStorage reads/writes.
let _chain: Promise<void> = Promise.resolve();

// ── Serialization ─────────────────────────────────────────────────────────────
// serverTimestamp() sentinels from firebase/firestore are not JSON-serializable.
// We capture them as the client timestamp at enqueue time.

function isServerTimestampSentinel(v: unknown): boolean {
  return (
    v != null &&
    typeof v === 'object' &&
    ((v as any)._methodName === 'serverTimestamp' ||
      (v as any).type === 'serverTimestamp')
  );
}

function isFirestoreTimestamp(v: unknown): boolean {
  return (
    v != null &&
    typeof v === 'object' &&
    typeof (v as any).toMillis === 'function' &&
    typeof (v as any).seconds === 'number' &&
    typeof (v as any).nanoseconds === 'number'
  );
}

function serializeVal(v: unknown, now: number): unknown {
  if (isServerTimestampSentinel(v)) return { __type: 'clientTimestamp', ms: now };
  if (isFirestoreTimestamp(v)) return { __type: 'timestamp', ms: (v as Timestamp).toMillis() };
  if (Array.isArray(v)) return v.map(item => serializeVal(item, now));
  if (v !== null && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = serializeVal(val, now);
    }
    return out;
  }
  return v;
}

function deserializeVal(v: unknown): unknown {
  if (v !== null && typeof v === 'object') {
    const t = (v as any).__type;
    if (t === 'clientTimestamp' || t === 'timestamp') {
      return Timestamp.fromMillis((v as any).ms);
    }
    if (Array.isArray(v)) return (v as unknown[]).map(deserializeVal);
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = deserializeVal(val);
    }
    return out;
  }
  return v;
}

// ── Queue persistence ─────────────────────────────────────────────────────────

async function loadQueue(): Promise<OutboxEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as OutboxEntry[]) : [];
  } catch {
    return [];
  }
}

async function saveQueue(entries: OutboxEntry[]): Promise<void> {
  if (entries.length === 0) {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } else {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  }
}

// ── Chain helper ──────────────────────────────────────────────────────────────

function serialized(fn: () => Promise<void>): Promise<void> {
  const next = _chain.then(fn);
  // Keep chain alive even if fn throws; the caller of serialized() sees the error via `next`.
  _chain = next.catch(() => {});
  return next;
}

function notify(): void {
  listeners.forEach(l => l());
}

// ── Entry execution ───────────────────────────────────────────────────────────

async function executeEntry(entry: OutboxEntry): Promise<void> {
  if (entry.kind === 'operation') {
    const fn = registry.get(entry.name);
    if (!fn) throw new Error(`[offlineOutbox] No registered operation: "${entry.name}"`);
    await fn(entry.params);
    return;
  }

  const segs = entry.path.split('/');
  const ref = doc(db, segs[0], ...segs.slice(1)) as any;
  const data = entry.data
    ? (deserializeVal(entry.data) as Record<string, unknown>)
    : undefined;

  if (entry.op === 'setDoc') await setDoc(ref, data!, entry.options);
  else if (entry.op === 'updateDoc') await updateDoc(ref, data!);
  else await deleteDoc(ref);
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Register a named operation function. Call once at module load or component mount. */
export function registerOperation(
  name: string,
  fn: (params: unknown) => Promise<void>,
): void {
  registry.set(name, fn);
}

/**
 * Queue a fixed Firestore write. Returns immediately (fire-and-forget).
 * The write is persisted to AsyncStorage and flushed on next reconnect.
 */
export function enqueuePayload(
  op: PayloadOp,
  path: string,
  data?: Record<string, unknown>,
  options?: { merge?: boolean },
): void {
  const now = Date.now();
  const entry: PayloadEntry = {
    kind: 'payload',
    id: `ob_${now}_${Math.random().toString(36).slice(2, 7)}`,
    op,
    path,
    data: data ? (serializeVal(data, now) as Record<string, unknown>) : undefined,
    options,
    queuedAt: now,
  };

  // Optimistic in-memory update so the count is immediately visible to the UI.
  _count += 1;
  notify();

  serialized(async () => {
    const current = await loadQueue();
    const updated = [...current, entry];
    await saveQueue(updated);
    _count = updated.length; // sync from persisted truth
    notify();
  }).catch(e => console.error('[offlineOutbox] enqueue failed:', e));
}

/**
 * Queue a named operation. Returns immediately (fire-and-forget).
 * params must be JSON-serializable.
 */
export function enqueueOperation(name: string, params: unknown = null): void {
  const now = Date.now();
  const entry: OperationEntry = {
    kind: 'operation',
    id: `ob_${now}_${Math.random().toString(36).slice(2, 7)}`,
    name,
    params,
    queuedAt: now,
  };

  _count += 1;
  notify();

  serialized(async () => {
    const current = await loadQueue();
    const updated = [...current, entry];
    await saveQueue(updated);
    _count = updated.length;
    notify();
  }).catch(e => console.error('[offlineOutbox] enqueue failed:', e));
}

/**
 * Flush the queue in FIFO order. Stops at the first failed entry —
 * that entry and all subsequent entries remain in the queue for the next flush.
 * Called automatically on reconnect; also exported for manual triggers.
 */
export function flushOutbox(): Promise<void> {
  return serialized(async () => {
    for (;;) {
      const entries = await loadQueue();
      if (entries.length === 0) break;

      const [head, ...tail] = entries;
      try {
        await executeEntry(head);
        await saveQueue(tail);
        _count = tail.length;
        notify();
      } catch {
        // Stop. head stays at the front of the queue for the next flush attempt.
        break;
      }
    }
  });
}

/** Current pending write count. Useful for "Syncing" indicators outside React. */
export function getOutboxCount(): number {
  return _count;
}

/** React hook that returns pending write count and re-renders on change. */
export function useOutboxCount(): number {
  const [count, setCount] = useState(_count);
  useEffect(() => {
    const update = () => setCount(_count);
    listeners.add(update);
    update(); // sync in case _count changed between render and effect
    return () => { listeners.delete(update); };
  }, []);
  return count;
}

/**
 * Initialize the outbox: load the persisted queue count and subscribe to
 * NetInfo for automatic flush on reconnect. Call once at app startup.
 */
export function initOutbox(): void {
  if (_initialized) return;
  _initialized = true;

  // Put the initial load on the chain so flushOutbox() called right after
  // initOutbox() will correctly chain after the count is loaded.
  serialized(async () => {
    const entries = await loadQueue();
    _count = entries.length;
    notify();
  }).catch(() => {});

  NetInfo.addEventListener(state => {
    const online =
      state.isConnected === true && state.isInternetReachable !== false;
    if (online) {
      flushOutbox().catch(e => console.error('[offlineOutbox] flush error:', e));
    }
  });
}

// ── Test utilities ────────────────────────────────────────────────────────────

/** Reset all module state. Call in beforeEach to isolate tests. */
export function _resetForTesting(): void {
  registry.clear();
  listeners.clear();
  _count = 0;
  _initialized = false;
  _chain = Promise.resolve();
}

/**
 * Await the current operation chain. Useful in tests to ensure all
 * fire-and-forget enqueues have been persisted before asserting.
 */
export function _drainForTesting(): Promise<void> {
  return _chain;
}
