/**
 * Tests for voidSalesReportLogic — endpoint logic with a mocked Firestore.
 *
 * All tests use the in-memory FakeDb helper below; no emulator or real
 * Firebase connection is needed.
 */

import { voidSalesReportLogic } from '../voidSalesReportLogic';

// ── Minimal Firestore mock ─────────────────────────────────────────────────────

type DocData = Record<string, any>;

class FakeDocRef {
  constructor(private store: Map<string, DocData>, public path: string) {}

  async get(): Promise<{ exists: boolean; data: () => DocData | undefined }> {
    const d = this.store.get(this.path);
    return { exists: d !== undefined, data: () => d };
  }

  async update(fields: DocData): Promise<void> {
    const existing = this.store.get(this.path) ?? {};
    this.store.set(this.path, { ...existing, ...fields });
  }

  async delete(): Promise<void> {
    this.store.delete(this.path);
  }

  get id(): string {
    return this.path.split('/').pop()!;
  }

  // Mirrors QueryDocumentSnapshot.ref — the logic calls batch.delete(d.ref).
  get ref(): FakeDocRef { return this; }
}

class FakeQuerySnapshot {
  constructor(public docs: FakeDocRef[]) {}
  get size(): number { return this.docs.length; }
}

class FakeCollectionRef {
  constructor(private store: Map<string, DocData>, private collPath: string) {}

  where(field: string, op: '==' | string, value: any): this {
    // Filter is applied lazily in get().
    const original = this;
    const filtered = new FakeCollectionRef(this.store, this.collPath);
    const origGet = filtered.get.bind(filtered);
    filtered.get = async () => {
      const all = await origGet();
      const matched = all.docs.filter(d => {
        const data = this.store.get(d.path);
        return data && data[field] === value;
      });
      return new FakeQuerySnapshot(matched);
    };
    return filtered as this;
  }

  async get(): Promise<FakeQuerySnapshot> {
    const docs: FakeDocRef[] = [];
    for (const [path] of this.store) {
      if (path.startsWith(this.collPath + '/') && !path.slice(this.collPath.length + 1).includes('/')) {
        docs.push(new FakeDocRef(this.store, path));
      }
    }
    return new FakeQuerySnapshot(docs);
  }

  async add(data: DocData): Promise<FakeDocRef> {
    const id = `auto_${Math.random().toString(36).slice(2)}`;
    const path = `${this.collPath}/${id}`;
    this.store.set(path, data);
    return new FakeDocRef(this.store, path);
  }
}

class FakeBatch {
  private ops: Array<() => void> = [];
  constructor(private store: Map<string, DocData>) {}
  delete(ref: FakeDocRef): void { this.ops.push(() => this.store.delete(ref.path)); }
  set(ref: FakeDocRef, data: DocData): void { this.ops.push(() => this.store.set(ref.path, data)); }
  async commit(): Promise<void> { this.ops.forEach(op => op()); }
}

class FakeDb {
  store = new Map<string, DocData>();
  accessLog: string[] = [];  // records every doc()/collection() call path

  doc(path: string): FakeDocRef {
    this.accessLog.push(`doc:${path}`);
    return new FakeDocRef(this.store, path);
  }

  collection(path: string): FakeCollectionRef {
    this.accessLog.push(`col:${path}`);
    return new FakeCollectionRef(this.store, path);
  }

  batch(): FakeBatch {
    return new FakeBatch(this.store);
  }

  /** Seed a document at path. */
  seed(path: string, data: DocData): void {
    this.store.set(path, data);
  }

  /** Check a document exists. */
  has(path: string): boolean {
    return this.store.has(path);
  }

  /** Read a document's data. */
  read(path: string): DocData | undefined {
    return this.store.get(path);
  }
}

// admin.firestore.FieldValue.serverTimestamp() returns a sentinel — use a plain string in tests.
jest.mock('firebase-admin', () => ({
  firestore: {
    FieldValue: { serverTimestamp: () => '__SERVER_TIMESTAMP__' },
  },
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const VENUE   = 'venue_test';
const REPORT  = 'report_test';
const OWNER   = 'uid_owner';
const MANAGER = 'uid_manager';
const STAFF   = 'uid_staff';

function baseDb(): FakeDb {
  const db = new FakeDb();
  db.seed(`venues/${VENUE}/members/${OWNER}`,   { role: 'owner' });
  db.seed(`venues/${VENUE}/members/${MANAGER}`, { role: 'manager' });
  db.seed(`venues/${VENUE}/members/${STAFF}`,   { role: 'staff' });
  db.seed(`venues/${VENUE}/salesReports/${REPORT}`, { status: 'active', report: { lines: [] } });
  return db;
}

// ── Auth / role tests ─────────────────────────────────────────────────────────

describe('auth and role checks', () => {
  test('staff member is refused with 403', async () => {
    const db = baseDb();
    const result = await voidSalesReportLogic(db as any, VENUE, REPORT, STAFF, 'test reason');
    expect(result).toEqual({ ok: false, status: 403, error: expect.stringContaining('manager') });
  });

  test('non-member is refused with 403', async () => {
    const db = baseDb();
    const result = await voidSalesReportLogic(db as any, VENUE, REPORT, 'uid_nobody', 'test reason');
    expect(result).toEqual({ ok: false, status: 403, error: expect.any(String) });
  });

  test('manager is allowed', async () => {
    const db = baseDb();
    const result = await voidSalesReportLogic(db as any, VENUE, REPORT, MANAGER, 'test reason');
    expect(result).toMatchObject({ ok: true, needsReenrich: true });
  });

  test('owner is allowed', async () => {
    const db = baseDb();
    const result = await voidSalesReportLogic(db as any, VENUE, REPORT, OWNER, 'test reason');
    expect(result).toMatchObject({ ok: true, needsReenrich: true });
  });
});

// ── ID format validation — no DB access on rejection ─────────────────────────

describe('ID format validation', () => {
  async function expectRejected(venueId: any, reportId: any, msgFragment: string) {
    const db = baseDb();
    db.accessLog = [];
    const result = await voidSalesReportLogic(db as any, venueId, reportId, OWNER, 'valid reason');
    expect(result).toMatchObject({ ok: false, status: 400, error: expect.stringContaining(msgFragment) });
    expect(db.accessLog).toHaveLength(0);  // NO database access before validation
  }

  test('venueId with slash "a/b" → 400, no DB access', () =>
    expectRejected('a/b', REPORT, 'venueId'));

  test('venueId path traversal "../x" → 400, no DB access', () =>
    expectRejected('../x', REPORT, 'venueId'));

  test('empty venueId "" → 400, no DB access', () =>
    expectRejected('', REPORT, 'venueId'));

  test('venueId too short (5 chars) → 400, no DB access', () =>
    expectRejected('abcde', REPORT, 'venueId'));

  test('venueId too long (65 chars) → 400, no DB access', () =>
    expectRejected('a'.repeat(65), REPORT, 'venueId'));

  test('non-string venueId (null) → 400, no DB access', () =>
    expectRejected(null, REPORT, 'venueId'));

  test('non-string venueId (number) → 400, no DB access', () =>
    expectRejected(123456, REPORT, 'venueId'));

  test('reportId with embedded path "x/salesReportMatches/y" → 400, no DB access', () =>
    expectRejected(VENUE, 'x/salesReportMatches/y', 'reportId'));

  test('reportId with dot "a.b" → 400, no DB access', () =>
    expectRejected(VENUE, 'a.b', 'reportId'));

  test('200-character reportId → 400, no DB access', () =>
    expectRejected(VENUE, 'r'.repeat(200), 'reportId'));

  test('non-string reportId (object) → 400, no DB access', () =>
    expectRejected(VENUE, { id: 'x' }, 'reportId'));

  test('valid ids pass validation and reach DB', async () => {
    const db = baseDb();
    db.accessLog = [];
    await voidSalesReportLogic(db as any, VENUE, REPORT, OWNER, 'valid reason');
    expect(db.accessLog.length).toBeGreaterThan(0);
  });
});

// ── Input validation ──────────────────────────────────────────────────────────

describe('input validation', () => {
  test('missing reportId → 400', async () => {
    const db = baseDb();
    const result = await voidSalesReportLogic(db as any, VENUE, '', OWNER, 'test reason');
    expect(result).toEqual({ ok: false, status: 400, error: expect.any(String) });
  });

  test('missing venueId → 400', async () => {
    const db = baseDb();
    const result = await voidSalesReportLogic(db as any, '', REPORT, OWNER, 'test reason');
    expect(result).toEqual({ ok: false, status: 400, error: expect.any(String) });
  });

  test('reason too short (2 chars) → 400', async () => {
    const db = baseDb();
    const result = await voidSalesReportLogic(db as any, VENUE, REPORT, OWNER, 'ab');
    expect(result).toEqual({ ok: false, status: 400, error: expect.stringContaining('reason') });
  });

  test('reason exactly 3 chars → ok', async () => {
    const db = baseDb();
    const result = await voidSalesReportLogic(db as any, VENUE, REPORT, OWNER, 'abc');
    expect(result).toMatchObject({ ok: true });
  });

  test('missing report → 404', async () => {
    const db = baseDb();
    const result = await voidSalesReportLogic(db as any, VENUE, 'no_such_report', OWNER, 'test reason');
    expect(result).toEqual({ ok: false, status: 404, error: expect.any(String) });
  });
});

// ── Successful void ───────────────────────────────────────────────────────────

describe('successful void', () => {
  test('sets status voided on the report', async () => {
    const db = baseDb();
    await voidSalesReportLogic(db as any, VENUE, REPORT, OWNER, 'duplicate upload');
    const doc = db.read(`venues/${VENUE}/salesReports/${REPORT}`);
    expect(doc?.status).toBe('voided');
    expect(doc?.voidedBy).toBe(OWNER);
    expect(doc?.voidReason).toBe('duplicate upload');
    expect(doc?.voidCleanupComplete).toBe(true);
  });

  test('writes an auditLog entry', async () => {
    const db = baseDb();
    await voidSalesReportLogic(db as any, VENUE, REPORT, OWNER, 'test reason');
    const auditEntries = [...db.store.entries()].filter(([k]) => k.startsWith(`venues/${VENUE}/auditLog/`));
    expect(auditEntries.length).toBe(1);
    expect(auditEntries[0][1]).toMatchObject({ action: 'void_sales_report', reportId: REPORT, voidedBy: OWNER });
  });

  test('returns ok:true, needsReenrich:true, voidedAt string', async () => {
    const db = baseDb();
    const result = await voidSalesReportLogic(db as any, VENUE, REPORT, OWNER, 'test reason');
    expect(result).toMatchObject({ ok: true, needsReenrich: true });
    expect(typeof (result as any).voidedAt).toBe('string');
  });
});

// ── Derived document cleanup ──────────────────────────────────────────────────

describe('derived document cleanup', () => {
  function seedDerived(db: FakeDb): void {
    db.seed(`venues/${VENUE}/salesReportMatches/match1`,       { reportId: REPORT });
    db.seed(`venues/${VENUE}/salesReportMatches/${REPORT}`,    { reportId: REPORT }); // server-keyed
    db.seed(`venues/${VENUE}/salesReportUnknowns/unk1`,        { reportId: REPORT, status: 'unmapped' });
    db.seed(`venues/${VENUE}/salesReportRecipeMatches/rm1`,    { reportId: REPORT });
    db.seed(`venues/${VENUE}/recipeSalesAttribution/ra1`,      { reportId: REPORT });
    db.seed(`venues/${VENUE}/processedSalesReports/proc1`,     { reportId: REPORT });
    // Unrelated docs (different reportId) — must survive.
    db.seed(`venues/${VENUE}/salesReportMatches/other_match`,  { reportId: 'other_report' });
    db.seed(`venues/${VENUE}/salesReportUnknowns/other_unk`,   { reportId: 'other_report' });
  }

  test('deletes all derived docs for the voided report', async () => {
    const db = baseDb();
    seedDerived(db);
    await voidSalesReportLogic(db as any, VENUE, REPORT, OWNER, 'cleanup test');
    expect(db.has(`venues/${VENUE}/salesReportMatches/match1`)).toBe(false);
    expect(db.has(`venues/${VENUE}/salesReportMatches/${REPORT}`)).toBe(false);
    expect(db.has(`venues/${VENUE}/salesReportUnknowns/unk1`)).toBe(false);
    expect(db.has(`venues/${VENUE}/salesReportRecipeMatches/rm1`)).toBe(false);
    expect(db.has(`venues/${VENUE}/recipeSalesAttribution/ra1`)).toBe(false);
    expect(db.has(`venues/${VENUE}/processedSalesReports/proc1`)).toBe(false);
  });

  test('does NOT delete derived docs for other reports', async () => {
    const db = baseDb();
    seedDerived(db);
    await voidSalesReportLogic(db as any, VENUE, REPORT, OWNER, 'cleanup test');
    expect(db.has(`venues/${VENUE}/salesReportMatches/other_match`)).toBe(true);
    expect(db.has(`venues/${VENUE}/salesReportUnknowns/other_unk`)).toBe(true);
  });

  test('deletes processedSalesReports doc keyed by fileHash when present', async () => {
    const db = baseDb();
    db.seed(`venues/${VENUE}/salesReports/${REPORT}`, { status: 'active', meta: { fileHash: 'hash_abc' } });
    db.seed(`venues/${VENUE}/processedSalesReports/hash_abc`, { lineCount: 5 });
    await voidSalesReportLogic(db as any, VENUE, REPORT, OWNER, 'hash test');
    expect(db.has(`venues/${VENUE}/processedSalesReports/hash_abc`)).toBe(false);
  });
});

// ── Idempotency ───────────────────────────────────────────────────────────────

describe('idempotency', () => {
  test('second call after complete cleanup returns alreadyVoided:true', async () => {
    const db = baseDb();
    await voidSalesReportLogic(db as any, VENUE, REPORT, OWNER, 'first call');
    const second = await voidSalesReportLogic(db as any, VENUE, REPORT, OWNER, 'second call');
    expect(second).toEqual({ ok: true, alreadyVoided: true });
  });

  test('resume after partial cleanup (voidCleanupComplete: false) continues and completes', async () => {
    const db = baseDb();
    // Simulate partial: report already voided but cleanup not done.
    db.seed(`venues/${VENUE}/salesReports/${REPORT}`, {
      status: 'voided', voidedBy: OWNER, voidReason: 'first try', voidCleanupComplete: false,
    });
    db.seed(`venues/${VENUE}/salesReportUnknowns/leftover`, { reportId: REPORT, status: 'unmapped' });

    const result = await voidSalesReportLogic(db as any, VENUE, REPORT, OWNER, 'resume');
    expect(result).toMatchObject({ ok: true, needsReenrich: true });
    // Leftover doc from partial run is cleaned up.
    expect(db.has(`venues/${VENUE}/salesReportUnknowns/leftover`)).toBe(false);
    // Cleanup marked complete.
    expect(db.read(`venues/${VENUE}/salesReports/${REPORT}`)?.voidCleanupComplete).toBe(true);
  });
});

// ── Chunking ──────────────────────────────────────────────────────────────────

describe('chunking over 400 documents', () => {
  test('deletes > 400 salesReportUnknowns in multiple batches', async () => {
    const db = baseDb();
    const COUNT = 450;
    for (let i = 0; i < COUNT; i++) {
      db.seed(`venues/${VENUE}/salesReportUnknowns/unk_${i}`, { reportId: REPORT, status: 'unmapped' });
    }
    await voidSalesReportLogic(db as any, VENUE, REPORT, OWNER, 'chunking test');
    for (let i = 0; i < COUNT; i++) {
      expect(db.has(`venues/${VENUE}/salesReportUnknowns/unk_${i}`)).toBe(false);
    }
  });
});
