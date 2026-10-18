/**
 * Behavioural tests for POSMappingScreen's mapping logic.
 *
 * Mirrors the production logic in POSMappingScreen.tsx:
 * - confirmMapping: setDoc with deterministic id + batch-update unknowns to 'mapped'
 * - Re-mapping uses the same doc id (idempotent merge, not a second doc)
 */

jest.mock('../../../services/firebase', () => ({ db: {} }));
jest.mock('firebase/firestore', () => {
  const docFn = jest.fn((...args: any[]) => ({ _path: args.filter(Boolean).join('/') }));
  return {
    doc: docFn,
    collection: jest.fn((...args: any[]) => ({ _path: args.filter(Boolean).join('/') })),
    query: jest.fn((ref: any, ...constraints: any[]) => ({ ...ref, _constraints: constraints })),
    where: jest.fn((field: string, op: string, val: any) => ({ _where: { field, op, val } })),
    getDocs: jest.fn(),
    setDoc: jest.fn(() => Promise.resolve()),
    writeBatch: jest.fn(),
    serverTimestamp: jest.fn(() => '__TS__'),
  };
});

import * as firestore from 'firebase/firestore';

const mockGetDocs = firestore.getDocs as jest.Mock;
const mockSetDoc = firestore.setDoc as jest.Mock;
const mockWriteBatch = firestore.writeBatch as jest.Mock;

// ── Pure helpers (mirrored from POSMappingScreen.tsx) ─────────────────────────

function normName(s: string): string {
  return (s || '').toLowerCase().trim().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ');
}

function mappingDocId(posItemName: string, posSystem: string): string {
  return `${normName(posItemName).replace(/\s+/g, '_')}_${posSystem}`.slice(0, 500);
}

// ── Inline of confirmMapping logic ─────────────────────────────────────────────

async function invokeConfirmMapping(opts: {
  venueId: string;
  adapterSystem: string;
  posItemName: string;
  posItemId: string;
  resolvedId: string;
  resolvedName: string;
  resolvedType: 'product' | 'recipe';
  conversionQty?: string;
  conversionUnit?: string;
  uid?: string;
  unknownDocs?: Array<{ id: string; lineName: string }>;
}) {
  const {
    venueId, adapterSystem, posItemName, posItemId,
    resolvedId, resolvedName, resolvedType,
    conversionQty = '1', conversionUnit = 'each',
    uid = 'uid-test',
    unknownDocs = [],
  } = opts;

  const { doc, collection, query, where, getDocs, setDoc, writeBatch, serverTimestamp } =
    jest.requireMock('firebase/firestore');
  const { db } = jest.requireMock('../../../services/firebase');

  const isProduct = resolvedType === 'product';
  const ratio = isProduct ? (parseFloat(conversionQty) || 1) : null;
  const docId = mappingDocId(posItemName, adapterSystem);

  await setDoc(
    doc(db, 'venues', venueId, 'posProductMappings', docId),
    {
      posSystem: adapterSystem,
      posItemId,
      posItemName,
      posSku: null,
      mappingType: isProduct ? 'direct_product' : 'recipe',
      productId: isProduct ? resolvedId : null,
      productName: isProduct ? resolvedName : null,
      conversionRatio: ratio,
      conversionUnit: isProduct ? conversionUnit : null,
      recipeId: !isProduct ? resolvedId : null,
      recipeName: !isProduct ? resolvedName : null,
      mappingConfidence: 'manual',
      createdAt: serverTimestamp(),
      createdBy: uid,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );

  // Mark matching unknowns
  const norm = normName(posItemName);
  const toMark = unknownDocs.filter(d => normName(d.lineName) === norm);
  if (toMark.length > 0) {
    const batchFns = jest.requireMock('firebase/firestore').writeBatch(db);
    toMark.forEach(d => {
      const ref = doc(db, 'venues', venueId, 'salesReportUnknowns', d.id);
      batchFns.update(ref, { status: 'mapped' });
    });
    await batchFns.commit();
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POSMappingScreen — confirmMapping', () => {
  let mockUpdate: jest.Mock;
  let mockCommit: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockUpdate = jest.fn();
    mockCommit = jest.fn().mockResolvedValue(undefined);
    mockWriteBatch.mockReturnValue({ update: mockUpdate, commit: mockCommit });
    mockSetDoc.mockResolvedValue(undefined);
  });

  it('calls setDoc with deterministic doc id (not addDoc)', async () => {
    await invokeConfirmMapping({
      venueId: 'v1', adapterSystem: 'square',
      posItemName: 'House Red Wine', posItemId: 'pos-1',
      resolvedId: 'prod-1', resolvedName: 'Red Wine', resolvedType: 'product',
      unknownDocs: [],
    });

    expect(mockSetDoc).toHaveBeenCalledTimes(1);
    const [docRef, , opts] = mockSetDoc.mock.calls[0];
    expect((docRef._path as string).endsWith('posProductMappings/house_red_wine_square')).toBe(true);
    expect(opts).toEqual({ merge: true });
  });

  it('re-mapping uses the same doc id (no second doc created)', async () => {
    await invokeConfirmMapping({
      venueId: 'v1', adapterSystem: 'square',
      posItemName: 'House Red Wine', posItemId: 'pos-1',
      resolvedId: 'prod-1', resolvedName: 'Red Wine', resolvedType: 'product',
      unknownDocs: [],
    });
    await invokeConfirmMapping({
      venueId: 'v1', adapterSystem: 'square',
      posItemName: 'House Red Wine', posItemId: 'pos-1',
      resolvedId: 'prod-2', resolvedName: 'Red Wine Premium', resolvedType: 'product',
      unknownDocs: [],
    });

    // Both calls use the same doc id
    const [ref1] = mockSetDoc.mock.calls[0];
    const [ref2] = mockSetDoc.mock.calls[1];
    // Same suffix (deterministic id) regardless of db object prefix
    const suffix = (p: string) => p.split('posProductMappings/')[1];
    expect(suffix(ref1._path)).toBe(suffix(ref2._path));
    expect(mockSetDoc).toHaveBeenCalledTimes(2); // two updates to same doc, not two new docs
  });

  it('marks all unknowns whose normalised name matches as mapped', async () => {
    const unknownDocs = [
      { id: 'u1', lineName: 'House Red Wine' },       // exact match
      { id: 'u2', lineName: 'house red wine' },        // lowercase match
      { id: 'u3', lineName: 'House Red Wine  ' },      // extra spaces
      { id: 'u4', lineName: 'Sauvignon Blanc' },       // different — no match
    ];

    await invokeConfirmMapping({
      venueId: 'v1', adapterSystem: 'square',
      posItemName: 'House Red Wine', posItemId: 'pos-1',
      resolvedId: 'prod-1', resolvedName: 'Red Wine', resolvedType: 'product',
      unknownDocs,
    });

    // 3 unknowns match (u1, u2, u3); u4 does not
    expect(mockUpdate).toHaveBeenCalledTimes(3);
    const updatedPaths = mockUpdate.mock.calls.map(([ref]: any[]) => ref._path as string);
    expect(updatedPaths.some(p => p.endsWith('salesReportUnknowns/u1'))).toBe(true);
    expect(updatedPaths.some(p => p.endsWith('salesReportUnknowns/u2'))).toBe(true);
    expect(updatedPaths.some(p => p.endsWith('salesReportUnknowns/u3'))).toBe(true);
    expect(updatedPaths.some(p => p.endsWith('salesReportUnknowns/u4'))).toBe(false);

    // Each update sets status: 'mapped'
    mockUpdate.mock.calls.forEach(([, payload]: any[]) => {
      expect(payload.status).toBe('mapped');
    });
    expect(mockCommit).toHaveBeenCalledTimes(1);
  });

  it('does not call writeBatch when no unknowns match', async () => {
    await invokeConfirmMapping({
      venueId: 'v1', adapterSystem: 'square',
      posItemName: 'House Red Wine', posItemId: 'pos-1',
      resolvedId: 'prod-1', resolvedName: 'Red Wine', resolvedType: 'product',
      unknownDocs: [{ id: 'u1', lineName: 'Sauvignon Blanc' }],
    });

    expect(mockCommit).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('normName strips punctuation so "House Red Wine!" matches "House Red Wine"', async () => {
    const unknownDocs = [
      { id: 'u1', lineName: 'House Red Wine!' },
      { id: 'u2', lineName: 'House Red Wine - NZ' },
    ];

    await invokeConfirmMapping({
      venueId: 'v1', adapterSystem: 'square',
      posItemName: 'House Red Wine', posItemId: 'pos-1',
      resolvedId: 'prod-1', resolvedName: 'Red Wine', resolvedType: 'product',
      unknownDocs,
    });

    // 'house red wine' vs 'house red wine' — punctuation stripped → match
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const [[ref]] = mockUpdate.mock.calls;
    expect((ref._path as string).endsWith('salesReportUnknowns/u1')).toBe(true);
    // 'house red wine  nz' ≠ 'house red wine' → no match for u2
    expect(mockUpdate.mock.calls.some(([r]: any[]) => (r._path as string).endsWith('salesReportUnknowns/u2'))).toBe(false);
  });
});
