// Mocks must be declared before imports — Jest hoists jest.mock() calls.

jest.mock('../firebase', () => ({ db: {} }));

let capturedNetInfoListener: ((state: any) => void) | undefined;
jest.mock('@react-native-community/netinfo', () => ({
  addEventListener: jest.fn((cb: (state: any) => void) => {
    capturedNetInfoListener = cb;
    return jest.fn(); // unsubscribe fn
  }),
}));

jest.mock('firebase/firestore', () => ({
  doc: jest.fn((_db: any, col: string, ...rest: string[]) => ({
    _path: [col, ...rest].join('/'),
  })),
  setDoc: jest.fn(),
  updateDoc: jest.fn(),
  deleteDoc: jest.fn(),
  Timestamp: {
    fromMillis: jest.fn((ms: number) => ({ __fakeTs: true, ms })),
  },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as firestore from 'firebase/firestore';
import {
  enqueuePayload,
  enqueueOperation,
  flushOutbox,
  getOutboxCount,
  registerOperation,
  initOutbox,
  _resetForTesting,
  _drainForTesting,
} from '../offlineOutbox';

const mockSetDoc   = firestore.setDoc   as jest.Mock;
const mockUpdateDoc = firestore.updateDoc as jest.Mock;
const mockDeleteDoc = firestore.deleteDoc as jest.Mock;

beforeEach(async () => {
  jest.clearAllMocks();
  capturedNetInfoListener = undefined;
  _resetForTesting();
  await AsyncStorage.clear();
  // Default: writes succeed
  mockSetDoc.mockResolvedValue(undefined);
  mockUpdateDoc.mockResolvedValue(undefined);
  mockDeleteDoc.mockResolvedValue(undefined);
});

// ── 1. Persistence across restart ────────────────────────────────────────────

describe('persistence across restart', () => {
  it('queued entries survive a simulated app restart (AsyncStorage outlives module state)', async () => {
    // Queue two writes while "offline" (no flush)
    enqueuePayload('setDoc', 'venues/v1/requests/r1', { status: 'pending' });
    enqueuePayload('updateDoc', 'venues/v1/items/i2', { lastCount: 5 });

    // Drain the chain so AsyncStorage writes are complete before we reset
    await _drainForTesting();

    expect(getOutboxCount()).toBe(2);

    // Simulate restart: wipe module state but leave AsyncStorage intact
    _resetForTesting();
    expect(getOutboxCount()).toBe(0);

    // Re-initialize — loads count from AsyncStorage
    initOutbox();
    await _drainForTesting();

    expect(getOutboxCount()).toBe(2);
  });

  it('flushOutbox after restart processes the persisted entries', async () => {
    enqueuePayload('setDoc', 'venues/v1/requests/r1', { status: 'pending' });
    await _drainForTesting();

    _resetForTesting();
    initOutbox();
    await flushOutbox(); // chains after init, then processes the entry

    expect(mockSetDoc).toHaveBeenCalledTimes(1);
    expect(mockSetDoc.mock.calls[0][0]).toMatchObject({ _path: 'venues/v1/requests/r1' });
    expect(getOutboxCount()).toBe(0);
  });
});

// ── 2. FIFO order ─────────────────────────────────────────────────────────────

describe('flush order', () => {
  it('processes entries in the order they were enqueued', async () => {
    const order: string[] = [];
    registerOperation('op-a', async () => { order.push('a'); });
    registerOperation('op-b', async () => { order.push('b'); });
    registerOperation('op-c', async () => { order.push('c'); });

    enqueueOperation('op-a');
    enqueueOperation('op-b');
    enqueueOperation('op-c');
    await flushOutbox();

    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('interleaved payload and operation entries are flushed in enqueue order', async () => {
    const order: string[] = [];
    mockSetDoc.mockImplementation(async () => { order.push('setDoc'); });
    registerOperation('myOp', async () => { order.push('myOp'); });

    enqueuePayload('setDoc', 'venues/v1/x/1', { a: 1 });
    enqueueOperation('myOp', { foo: 'bar' });
    enqueuePayload('setDoc', 'venues/v1/x/2', { a: 2 });
    await flushOutbox();

    expect(order).toEqual(['setDoc', 'myOp', 'setDoc']);
  });
});

// ── 3. Failure mid-flush ──────────────────────────────────────────────────────

describe('partial failure mid-flush', () => {
  it('stops at first failed entry and preserves it and all subsequent entries', async () => {
    const order: string[] = [];
    registerOperation('first',  async () => { order.push('first'); });
    registerOperation('second', async () => { order.push('second'); throw new Error('network'); });
    registerOperation('third',  async () => { order.push('third'); });

    enqueueOperation('first');
    enqueueOperation('second');
    enqueueOperation('third');
    await flushOutbox();

    // Only first succeeded
    expect(order).toEqual(['first', 'second']);
    expect(getOutboxCount()).toBe(2); // second + third remain

    // Verify what's actually in AsyncStorage
    const raw = await AsyncStorage.getItem('@tallyup/offlineOutbox');
    const remaining = JSON.parse(raw!);
    expect(remaining).toHaveLength(2);
    expect(remaining[0].name).toBe('second');
    expect(remaining[1].name).toBe('third');
  });

  it('a second flush retries the failed entry', async () => {
    let callCount = 0;
    registerOperation('flaky', async () => {
      callCount += 1;
      if (callCount < 2) throw new Error('first attempt fails');
    });

    enqueueOperation('flaky');
    await flushOutbox(); // first attempt — fails, entry stays
    expect(getOutboxCount()).toBe(1);

    await flushOutbox(); // second attempt — succeeds
    expect(getOutboxCount()).toBe(0);
    expect(callCount).toBe(2);
  });
});

// ── 4. Payload entry type ─────────────────────────────────────────────────────

describe('payload entry', () => {
  it('setDoc — calls setDoc with the correct ref and data', async () => {
    enqueuePayload('setDoc', 'venues/v1/requests/r1', { status: 'pending', qty: 3 });
    await flushOutbox();

    expect(mockSetDoc).toHaveBeenCalledTimes(1);
    const [ref, data] = mockSetDoc.mock.calls[0];
    expect(ref._path).toBe('venues/v1/requests/r1');
    expect(data).toMatchObject({ status: 'pending', qty: 3 });
  });

  it('setDoc with merge:true — passes options through', async () => {
    enqueuePayload('setDoc', 'venues/v1/docs/d1', { x: 1 }, { merge: true });
    await flushOutbox();

    const [, , options] = mockSetDoc.mock.calls[0];
    expect(options).toEqual({ merge: true });
  });

  it('updateDoc — calls updateDoc with correct ref and data', async () => {
    enqueuePayload('updateDoc', 'venues/v1/items/i1', { lastCount: 10 });
    await flushOutbox();

    expect(mockUpdateDoc).toHaveBeenCalledTimes(1);
    const [ref, data] = mockUpdateDoc.mock.calls[0];
    expect(ref._path).toBe('venues/v1/items/i1');
    expect(data).toMatchObject({ lastCount: 10 });
  });

  it('deleteDoc — calls deleteDoc with the correct ref, no data', async () => {
    enqueuePayload('deleteDoc', 'venues/v1/items/i1');
    await flushOutbox();

    expect(mockDeleteDoc).toHaveBeenCalledTimes(1);
    expect(mockDeleteDoc.mock.calls[0][0]._path).toBe('venues/v1/items/i1');
  });

  it('serverTimestamp sentinels are serialized to client time and deserialized to Timestamp', async () => {
    const sentinel = { _methodName: 'serverTimestamp' }; // mimics real FieldValue shape
    enqueuePayload('setDoc', 'venues/v1/x/1', { createdAt: sentinel as any, name: 'test' });
    await flushOutbox();

    const [, data] = mockSetDoc.mock.calls[0];
    // createdAt should have been deserialized back to a Timestamp via fromMillis
    expect((firestore.Timestamp.fromMillis as jest.Mock)).toHaveBeenCalled();
    // name should pass through unchanged
    expect(data.name).toBe('test');
  });

  it('survives serialization round-trip through AsyncStorage', async () => {
    enqueuePayload('setDoc', 'venues/v1/x/1', { value: 42, label: 'hello' });
    await _drainForTesting();

    // Simulate restart
    _resetForTesting();
    initOutbox();
    await flushOutbox();

    const [, data] = mockSetDoc.mock.calls[0];
    expect(data).toMatchObject({ value: 42, label: 'hello' });
  });
});

// ── 5. Operation entry type ───────────────────────────────────────────────────

describe('operation entry', () => {
  it('calls the registered function with the original params', async () => {
    const fn = jest.fn().mockResolvedValue(undefined);
    registerOperation('doTransfer', fn);

    const params = { fromBarId: 'bar1', toBarId: 'bar2', productId: 'p1', qty: 6 };
    enqueueOperation('doTransfer', params);
    await flushOutbox();

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(params);
  });

  it('throws if the operation name is not registered', async () => {
    enqueueOperation('unregistered-op');
    // flushOutbox should stop (the error is caught internally); entry stays in queue
    await flushOutbox();
    expect(getOutboxCount()).toBe(1);
  });

  it('params survive serialization round-trip through AsyncStorage', async () => {
    const fn = jest.fn().mockResolvedValue(undefined);
    registerOperation('myOp', fn);

    const params = { venueId: 'v1', barId: 'b1', qty: 99, label: 'test' };
    enqueueOperation('myOp', params);
    await _drainForTesting();

    _resetForTesting();
    registerOperation('myOp', fn); // re-register after reset
    initOutbox();
    await flushOutbox();

    expect(fn).toHaveBeenCalledWith(params);
  });
});

// ── 6. NetInfo reconnect trigger ──────────────────────────────────────────────

describe('NetInfo reconnect', () => {
  it('automatically flushes the queue when connectivity is restored', async () => {
    const fn = jest.fn().mockResolvedValue(undefined);
    registerOperation('onReconnect', fn);

    initOutbox(); // subscribes to NetInfo
    await _drainForTesting();

    enqueueOperation('onReconnect', { tag: 'reconnect-test' });
    await _drainForTesting();

    expect(fn).not.toHaveBeenCalled(); // not yet flushed

    // Simulate going online — triggers auto-flush internally
    capturedNetInfoListener!({ isConnected: true, isInternetReachable: true });
    // Chain after the auto-flush that was triggered inside the listener
    await flushOutbox();

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does not flush on connectivity events that are not fully online', async () => {
    const fn = jest.fn().mockResolvedValue(undefined);
    registerOperation('shouldNotRun', fn);

    initOutbox();
    await _drainForTesting();

    enqueueOperation('shouldNotRun');
    await _drainForTesting();

    // isInternetReachable is false — still offline behind a captive portal
    capturedNetInfoListener!({ isConnected: true, isInternetReachable: false });
    // Drain any side-effects from the listener, but do NOT call flushOutbox()
    // directly — that would bypass the connectivity check and flush unconditionally.
    await _drainForTesting();

    expect(fn).not.toHaveBeenCalled();
    expect(getOutboxCount()).toBe(1);
  });
});

// ── 7. Count accuracy ─────────────────────────────────────────────────────────

describe('count tracking', () => {
  it('count reflects the live queue size through enqueue and flush', async () => {
    expect(getOutboxCount()).toBe(0);

    enqueuePayload('setDoc', 'venues/v1/x/1', {});
    enqueuePayload('setDoc', 'venues/v1/x/2', {});
    await _drainForTesting();

    expect(getOutboxCount()).toBe(2);

    await flushOutbox();
    expect(getOutboxCount()).toBe(0);
  });
});
