import {
  mapSubscriptionToVenueState,
  resolveVenueTarget,
  invoiceSubscriptionId,
  isStale,
  isOlderPaymentEvent,
  commitWebhookTransaction,
  shouldRetryUnlinked,
} from '../stripeWebhookLogic';

// ── Fake Firestore helpers ────────────────────────────────────────────────────

class FakeTx {
  writes: Array<{ op: 'set' | 'update'; path: string; data: any; opts?: any }> = [];
  private docs: Map<string, any>;

  constructor(docs: Map<string, any>) {
    this.docs = docs;
  }

  async get(ref: any): Promise<{ exists: boolean; data: () => any | null }> {
    const path: string = typeof ref === 'string' ? ref : ref.path;
    const data = this.docs.get(path);
    return { exists: data !== undefined, data: () => data ?? null };
  }

  set(ref: any, data: any, opts?: any) {
    this.writes.push({ op: 'set', path: typeof ref === 'string' ? ref : ref.path, data, opts });
  }

  update(ref: any, data: any) {
    this.writes.push({ op: 'update', path: typeof ref === 'string' ? ref : ref.path, data });
  }
}

class FakeDb {
  docs: Map<string, any>;
  lastTx: FakeTx | null = null;

  constructor(initialDocs: Record<string, any> = {}) {
    this.docs = new Map(Object.entries(initialDocs));
  }

  doc(path: string) {
    return { path };
  }

  async runTransaction(fn: (tx: FakeTx) => Promise<void>): Promise<void> {
    const tx = new FakeTx(new Map(this.docs));
    await fn(tx); // throws propagate out; writes are not applied on throw
    this.lastTx = tx;
    for (const w of tx.writes) {
      if (w.op === 'set') {
        const existing = this.docs.get(w.path);
        this.docs.set(w.path, w.opts?.merge ? { ...(existing ?? {}), ...w.data } : w.data);
      } else if (w.op === 'update') {
        const existing = this.docs.get(w.path) ?? {};
        this.docs.set(w.path, { ...existing, ...w.data });
      }
    }
  }
}

// ── mapSubscriptionToVenueState ───────────────────────────────────────────────

function makeSub(overrides: any = {}): any {
  return {
    id: 'sub_1',
    status: 'active',
    customer: 'cus_1',
    items: {
      data: [
        { price: { metadata: { plan: 'core' }, id: 'price_core' }, quantity: 1, current_period_end: 1700000000 },
      ],
    },
    metadata: {},
    ...overrides,
  };
}

describe('mapSubscriptionToVenueState', () => {
  test('plan item not first — picks item with price.metadata.plan', () => {
    const sub = makeSub({
      items: {
        data: [
          { price: { metadata: {}, id: 'price_mod' }, quantity: 1, current_period_end: 1700000001 },
          { price: { metadata: { plan: 'pro' }, id: 'price_pro' }, quantity: 3, current_period_end: 1700000002 },
        ],
      },
    });
    const result = mapSubscriptionToVenueState(sub, 1000);
    expect(result.plan).toBe('pro');
    expect(result.quantity).toBe(3);
    expect(result.currentPeriodEnd).toBe(new Date(1700000002 * 1000).toISOString());
  });

  test('module comma-split and de-duplication across all items', () => {
    const sub = makeSub({
      items: {
        data: [
          { price: { metadata: { plan: 'pro', module: 'ops,analytics' }, id: 'p1' }, quantity: 1, current_period_end: 1700000000 },
          { price: { metadata: { module: 'analytics,reports' }, id: 'p2' }, quantity: 1, current_period_end: 1700000000 },
        ],
      },
    });
    const result = mapSubscriptionToVenueState(sub, 1000);
    expect(result.modules).toEqual(expect.arrayContaining(['ops', 'analytics', 'reports']));
    expect(result.modules).toHaveLength(3); // de-duplicated
  });

  test('canceled → cancelled, plan null, modules []', () => {
    const sub = makeSub({ status: 'canceled' });
    const result = mapSubscriptionToVenueState(sub, 1000);
    expect(result.status).toBe('cancelled');
    expect(result.plan).toBeNull();
    expect(result.modules).toEqual([]);
  });

  test('quantity and currentPeriodEnd taken from the plan item, not items[0]', () => {
    const sub = makeSub({
      items: {
        data: [
          { price: { metadata: {}, id: 'price_mod' }, quantity: 5, current_period_end: 1700000010 },
          { price: { metadata: { plan: 'core' }, id: 'price_core' }, quantity: 2, current_period_end: 1700000020 },
        ],
      },
    });
    const result = mapSubscriptionToVenueState(sub, 1000);
    expect(result.quantity).toBe(2);
    expect(result.currentPeriodEnd).toBe(new Date(1700000020 * 1000).toISOString());
  });

  test('customer as an expanded object', () => {
    const sub = makeSub({ customer: { id: 'cus_expanded', email: 'test@example.com' } });
    const result = mapSubscriptionToVenueState(sub, 1000);
    expect(result.stripeCustomerId).toBe('cus_expanded');
  });

  test('no undefined in returned object', () => {
    const sub = makeSub({ items: { data: [] }, customer: 'cus_1' });
    const result = mapSubscriptionToVenueState(sub, 1000);
    for (const [k, v] of Object.entries(result)) {
      expect(v).not.toBeUndefined(); // each field must be null/primitive/array, never undefined
      void k;
    }
    expect(result.plan).toBe('core'); // falls back when planItem is null
    expect(result.quantity).toBe(1);
    expect(result.currentPeriodEnd).toBeNull();
    expect(result.modules).toEqual([]);
  });
});

// ── resolveVenueTarget ────────────────────────────────────────────────────────

describe('resolveVenueTarget', () => {
  const sub = (metaVenueId?: string) => ({ metadata: metaVenueId ? { venueId: metaVenueId } : {} });

  test('metadata.venueId wins', () => {
    expect(resolveVenueTarget(sub('v1'), ['v2', 'v3'])).toEqual({ venueId: 'v1' });
  });

  test('exactly one customer match → venueId', () => {
    expect(resolveVenueTarget(sub(), ['v1'])).toEqual({ venueId: 'v1' });
  });

  test('zero customer matches → retry', () => {
    const result = resolveVenueTarget(sub(), []);
    expect(result).toHaveProperty('retry');
  });

  test('more than one customer match → ambiguous', () => {
    const result = resolveVenueTarget(sub(), ['v1', 'v2']) as any;
    expect(result.ambiguous).toEqual(['v1', 'v2']);
  });
});

// ── invoiceSubscriptionId ─────────────────────────────────────────────────────

describe('invoiceSubscriptionId', () => {
  test('invoice.subscription as string', () => {
    expect(invoiceSubscriptionId({ subscription: 'sub_1' })).toBe('sub_1');
  });

  test('invoice.parent.subscription_details.subscription', () => {
    expect(invoiceSubscriptionId({
      subscription: null,
      parent: { subscription_details: { subscription: 'sub_2' } },
    })).toBe('sub_2');
  });

  test('null when neither shape present', () => {
    expect(invoiceSubscriptionId({})).toBeNull();
    expect(invoiceSubscriptionId({ subscription: null })).toBeNull();
  });
});

// ── Stale guards ──────────────────────────────────────────────────────────────

describe('isStale', () => {
  test('incoming older than stored → stale', () => {
    expect(isStale(1000, 500)).toBe(true);
  });

  test('incoming newer than stored → not stale', () => {
    expect(isStale(500, 1000)).toBe(false);
  });

  test('no stored → never stale', () => {
    expect(isStale(undefined, 500)).toBe(false);
  });
});

describe('isOlderPaymentEvent', () => {
  test('incoming older than stored → true', () => {
    expect(isOlderPaymentEvent(1000, 500)).toBe(true);
  });

  test('incoming equal to stored → true (equal counts as older)', () => {
    expect(isOlderPaymentEvent(1000, 1000)).toBe(true);
  });

  test('incoming newer than stored → false', () => {
    expect(isOlderPaymentEvent(500, 1000)).toBe(false);
  });

  test('no stored → false', () => {
    expect(isOlderPaymentEvent(undefined, 1000)).toBe(false);
  });
});

// ── shouldRetryUnlinked ───────────────────────────────────────────────────────

describe('shouldRetryUnlinked', () => {
  const HOUR_MS = 60 * 60 * 1000;

  test('inside the window → true', () => {
    const createdSec = 1000;
    const nowMs = createdSec * 1000 + HOUR_MS - 1; // 1 ms before window closes
    expect(shouldRetryUnlinked(createdSec, nowMs)).toBe(true);
  });

  test('exactly at the window boundary → false', () => {
    const createdSec = 1000;
    const nowMs = createdSec * 1000 + HOUR_MS;
    expect(shouldRetryUnlinked(createdSec, nowMs)).toBe(false);
  });

  test('beyond the window → false', () => {
    const createdSec = 1000;
    const nowMs = createdSec * 1000 + HOUR_MS + 1;
    expect(shouldRetryUnlinked(createdSec, nowMs)).toBe(false);
  });

  test('default window is 1 hour', () => {
    const createdSec = 1000;
    // 59 min 59 s inside → still retrying
    expect(shouldRetryUnlinked(createdSec, createdSec * 1000 + HOUR_MS - 1)).toBe(true);
    // 1 h exactly → give up
    expect(shouldRetryUnlinked(createdSec, createdSec * 1000 + HOUR_MS)).toBe(false);
  });
});

// ── commitWebhookTransaction (fake-transaction tests) ────────────────────────

describe('commitWebhookTransaction', () => {
  const NOW = 1700000000000;

  test('second delivery of same event id writes nothing', async () => {
    const db = new FakeDb();
    const writeFn = jest.fn();

    const r1 = await commitWebhookTransaction(db, 'evt_1', 'customer.subscription.updated', 'v1', writeFn, NOW);
    expect(r1).toBe('written');
    expect(writeFn).toHaveBeenCalledTimes(1);

    const r2 = await commitWebhookTransaction(db, 'evt_1', 'customer.subscription.updated', 'v1', writeFn, NOW);
    expect(r2).toBe('duplicate');
    expect(writeFn).toHaveBeenCalledTimes(1); // not called again
  });

  test('AI extension increments exactly once across two deliveries', async () => {
    const db = new FakeDb({ 'venues/v1/aiUsage/2026-10': { extensionCallsPurchased: 0 } });
    const CALLS = 100;

    const writeFn = (tx: any) => {
      tx.set(
        { path: 'venues/v1/aiUsage/2026-10' },
        { extensionCallsPurchased: CALLS },
        { merge: true },
      );
    };

    await commitWebhookTransaction(db, 'evt_ai', 'checkout.session.completed', 'v1', writeFn, NOW);
    // First delivery applies the write
    expect(db.docs.get('venues/v1/aiUsage/2026-10')?.extensionCallsPurchased).toBe(CALLS);

    // Second delivery is duplicate — writeFn not called, doc unchanged
    await commitWebhookTransaction(db, 'evt_ai', 'checkout.session.completed', 'v1', writeFn, NOW);
    expect(db.docs.get('venues/v1/aiUsage/2026-10')?.extensionCallsPurchased).toBe(CALLS);
  });

  test('stale subscription sync is skipped but event is still marked', async () => {
    const db = new FakeDb({ 'venues/v1': { subscription: { status: 'active', stripeSyncedAt: 2000 } } });
    const staleSync = 500; // older than stored 2000

    const writeFn = async (tx: any) => {
      const venueRef = { path: 'venues/v1' };
      const venueDoc = await tx.get(venueRef);
      const storedSyncedAt = venueDoc.data()?.subscription?.stripeSyncedAt;
      if (!isStale(storedSyncedAt, staleSync)) {
        tx.set(venueRef, { subscription: { status: 'trialing', stripeSyncedAt: staleSync } }, { merge: true });
      }
    };

    const outcome = await commitWebhookTransaction(db, 'evt_stale', 'customer.subscription.updated', 'v1', writeFn, NOW);

    expect(outcome).toBe('written');
    // Event marker was written
    expect(db.docs.get('stripeEvents/evt_stale')).toBeDefined();
    // Venue was NOT updated (stale sync skipped)
    expect(db.docs.get('venues/v1')?.subscription?.status).toBe('active');
    expect(db.docs.get('venues/v1')?.subscription?.stripeSyncedAt).toBe(2000);
  });

  test('a throw part-way leaves no event marker', async () => {
    const db = new FakeDb();

    const throwingWriteFn = () => { throw new Error('mid-write failure'); };

    await expect(
      commitWebhookTransaction(db, 'evt_throw', 'customer.subscription.updated', 'v1', throwingWriteFn, NOW),
    ).rejects.toThrow('mid-write failure');

    expect(db.docs.get('stripeEvents/evt_throw')).toBeUndefined();
  });

  test('older payment event does not overwrite lastPaymentStatus', async () => {
    const db = new FakeDb({
      'venues/v1': {
        subscription: { lastPaymentStatus: 'ok', lastPaymentEventCreated: 1000 },
      },
    });

    const olderEventCreated = 500;
    const writeFn = async (tx: any) => {
      const venueRef = { path: 'venues/v1' };
      const venueDoc = await tx.get(venueRef);
      const stored = venueDoc.data()?.subscription?.lastPaymentEventCreated;
      if (!isOlderPaymentEvent(stored, olderEventCreated)) {
        tx.set(venueRef, {
          subscription: {
            lastPaymentStatus: 'failed',
            lastPaymentEventCreated: olderEventCreated,
          },
        }, { merge: true });
      }
    };

    await commitWebhookTransaction(db, 'evt_old_pay', 'invoice.payment_failed', 'v1', writeFn, NOW);

    const sub = db.docs.get('venues/v1')?.subscription;
    expect(sub?.lastPaymentStatus).toBe('ok'); // not overwritten
    expect(sub?.lastPaymentEventCreated).toBe(1000); // not overwritten
  });
});
