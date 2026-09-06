/**
 * Tests for mergedAliases write in mergeProducts (2a).
 *
 * Uses Vitest (the web-app's test runner) with vi.mock so every updateDoc
 * call can be inspected without touching Firestore.  arrayUnion is mocked to
 * return a detectable sentinel object so we can assert it was called with the
 * correct name.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Top-level mocks ───────────────────────────────────────────────────────────

const mockArrayUnion = vi.fn((v: string) => ({ _arrayUnion: v }));
const mockUpdateDoc  = vi.fn().mockResolvedValue(undefined);
const mockGetDoc     = vi.fn();
const mockGetDocs    = vi.fn().mockResolvedValue({ docs: [] });
const mockDoc        = vi.fn((...segs: string[]) => ({ _path: segs.join('/') }));

vi.mock('firebase/firestore', () => ({
  arrayUnion:      (...args: any[]) => mockArrayUnion(...args),
  collection:      vi.fn((...segs: string[]) => ({ _col: segs.join('/') })),
  doc:             (...args: any[]) => mockDoc(...args),
  getDoc:          (...args: any[]) => mockGetDoc(...args),
  getDocs:         (...args: any[]) => mockGetDocs(...args),
  addDoc:          vi.fn().mockResolvedValue({}),
  deleteDoc:       vi.fn().mockResolvedValue(undefined),
  setDoc:          vi.fn().mockResolvedValue(undefined),
  query:           vi.fn(col => col),
  where:           vi.fn(),
  serverTimestamp: vi.fn(() => 'SERVER_TS'),
  updateDoc:       (...args: any[]) => mockUpdateDoc(...args),
}));

vi.mock('../firebase', () => ({ db: {} }));

vi.mock('../services/productSuppliers', () => ({
  setPreferredProductSupplier: vi.fn(),
}));

// ── Import under test ─────────────────────────────────────────────────────────

import { mergeProducts } from '../services/mergeProducts';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeProductSnap(data: Record<string, any>) {
  return { exists: () => true, data: () => data };
}

function setupSnapshots(keepData: Record<string, any>, mergeData: Record<string, any>) {
  // getDoc is called twice via Promise.all([keepSnap, mergeSnap])
  mockGetDoc
    .mockResolvedValueOnce(makeProductSnap(keepData))
    .mockResolvedValueOnce(makeProductSnap(mergeData));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('mergeProducts — mergedAliases (2a write side)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDocs.mockResolvedValue({ docs: [] });
    mockUpdateDoc.mockResolvedValue(undefined);
  });

  it('M1: alias write always runs — arrayUnion called with the defunct name', async () => {
    setupSnapshots({ name: 'Gin (keep)' }, { name: 'Premium Gin', costPrice: 30 });

    await mergeProducts('v1', 'keep1', 'merge1');

    expect(mockArrayUnion).toHaveBeenCalledWith('Premium Gin');
  });

  it('M2: alias updateDoc targets the keepId document', async () => {
    setupSnapshots({ name: 'Gin (keep)' }, { name: 'Old Gin Name' });

    await mergeProducts('v1', 'keepA', 'mergeA');

    const aliasCall = mockUpdateDoc.mock.calls.find(
      ([_ref, payload]: [any, any]) => payload?.mergedAliases !== undefined,
    );
    expect(aliasCall).toBeDefined();
    expect(aliasCall![0]._path).toContain('keepA');
    expect(aliasCall![0]._path).not.toContain('mergeA');
  });

  it('M3: alias write runs even when no fields need backfilling (unconditional)', async () => {
    setupSnapshots(
      { name: 'Vodka', costPrice: 20, unit: 'ml', category: 'Spirits' },
      { name: 'Old Vodka', costPrice: 18, unit: 'ml', category: 'Spirits' },
    );

    await mergeProducts('v1', 'kVodka', 'mVodka');

    const aliasCall = mockUpdateDoc.mock.calls.find(
      ([_ref, payload]: [any, any]) => payload?.mergedAliases !== undefined,
    );
    expect(aliasCall).toBeDefined();
    expect(mockArrayUnion).toHaveBeenCalledWith('Old Vodka');
  });

  it('M4: alias write does not fire on dryRun:true', async () => {
    setupSnapshots({ name: 'Beer' }, { name: 'Craft Beer' });

    await mergeProducts('v1', 'kBeer', 'mBeer', true);

    const aliasCall = mockUpdateDoc.mock.calls.find(
      ([_ref, payload]: [any, any]) => payload?.mergedAliases !== undefined,
    );
    expect(aliasCall).toBeUndefined();
    expect(mockArrayUnion).not.toHaveBeenCalled();
  });

  it('M5: arrayUnion sentinel is written as the mergedAliases value', async () => {
    setupSnapshots({ name: 'Wine' }, { name: 'Red Wine Legacy' });

    await mergeProducts('v1', 'kWine', 'mWine');

    const aliasCall = mockUpdateDoc.mock.calls.find(
      ([_ref, payload]: [any, any]) => payload?.mergedAliases !== undefined,
    );
    expect(aliasCall![1].mergedAliases).toEqual({ _arrayUnion: 'Red Wine Legacy' });
  });

  it('M6: deactivation write also fires (regression — mergeId still gets active:false)', async () => {
    setupSnapshots({ name: 'Rum' }, { name: 'Dark Rum' });

    await mergeProducts('v1', 'kRum', 'mRum');

    const deactivateCall = mockUpdateDoc.mock.calls.find(
      ([_ref, payload]: [any, any]) => payload?.active === false,
    );
    expect(deactivateCall).toBeDefined();
    expect(deactivateCall![1]).toMatchObject({ active: false, mergedInto: 'kRum' });
  });
});
