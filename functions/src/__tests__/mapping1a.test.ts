import { describe, it, expect } from '@jest/globals';
import { planServerMappingWrite } from '../mappingWrite';

// ── planServerMappingWrite ────────────────────────────────────────────────────

describe('planServerMappingWrite', () => {
  it('uses the doc with earliest createdAt as canonical', () => {
    const docs = [
      { id: 'doc2', data: { posItemName: 'Wine', createdAt: { toMillis: () => 2000 } } },
      { id: 'doc1', data: { posItemName: 'Wine', createdAt: { toMillis: () => 1000 } } },
    ];
    const result = planServerMappingWrite(docs, { mappingType: 'direct_product', productId: 'p1', productName: 'X' }, 'Wine');
    expect(result.canonicalId).toBe('doc1');
    expect(result.deleteIds).toContain('doc2');
    expect(result.deleteIds).not.toContain('doc1');
  });

  it('falls back to normalized name when no docs exist', () => {
    const result = planServerMappingWrite([], { mappingType: 'skipped' }, 'Red Wine');
    expect(result.canonicalId).toBe('red_wine');
    expect(result.deleteIds).toHaveLength(0);
  });

  it('returns null fields and deletes all when newFieldsOrNull is null', () => {
    const docs = [
      { id: 'doc1', data: { posItemName: 'Wine' } },
      { id: 'doc2', data: { posItemName: 'Wine' } },
    ];
    const result = planServerMappingWrite(docs, null, 'Wine');
    expect(result.fields).toBeNull();
    expect(result.deleteIds).toHaveLength(2);
    expect(result.deleteIds).toContain('doc1');
    expect(result.deleteIds).toContain('doc2');
  });

  it('keeps posSystem from existing canonical doc', () => {
    const docs = [{ id: 'doc1', data: { posItemName: 'Wine', posSystem: 'lightspeed', createdAt: { toMillis: () => 1000 } } }];
    const result = planServerMappingWrite(docs, { mappingType: 'skipped' }, 'Wine');
    expect(result.fields?.posSystem).toBe('lightspeed');
  });

  it('groups mixed-case duplicates under canonical (earliest) id', () => {
    const docs = [
      { id: 'doc_wine', data: { posItemName: 'Wine', createdAt: { toMillis: () => 1000 } } },
      { id: 'doc_WINE', data: { posItemName: 'WINE', createdAt: { toMillis: () => 2000 } } },
    ];
    const result = planServerMappingWrite(docs, { mappingType: 'skipped' }, 'Wine');
    expect(result.canonicalId).toBe('doc_wine');
    expect(result.deleteIds).toContain('doc_WINE');
  });

  it('returns existingCreatedAt from canonical doc', () => {
    const ts = { toMillis: () => 1000 };
    const docs = [{ id: 'doc1', data: { posItemName: 'Wine', createdAt: ts } }];
    const result = planServerMappingWrite(docs, { mappingType: 'skipped' }, 'Wine');
    expect(result.existingCreatedAt).toBe(ts);
  });

  it('returns null existingCreatedAt when no existing docs', () => {
    const result = planServerMappingWrite([], { mappingType: 'skipped' }, 'Wine');
    expect(result.existingCreatedAt).toBeNull();
  });
});

// ── Undo selection ────────────────────────────────────────────────────────────

describe('undo selection', () => {
  function findLatestUndoable(entries: Array<{ undone: boolean; at: number }>) {
    return entries
      .filter(e => !e.undone)
      .sort((a, b) => b.at - a.at)[0] ?? null;
  }

  it('returns the latest non-undone entry', () => {
    const entries = [
      { undone: false, at: 1000 },
      { undone: false, at: 2000 },
      { undone: true, at: 3000 },
    ];
    expect(findLatestUndoable(entries)?.at).toBe(2000);
  });

  it('skips undone entries', () => {
    const entries = [
      { undone: true, at: 2000 },
      { undone: false, at: 1000 },
    ];
    expect(findLatestUndoable(entries)?.at).toBe(1000);
  });

  it('returns null when all are undone', () => {
    expect(findLatestUndoable([{ undone: true, at: 1000 }])).toBeNull();
  });

  it('returns null for empty list', () => {
    expect(findLatestUndoable([])).toBeNull();
  });
});

// ── Dated undo twice in a row ─────────────────────────────────────────────────

describe('dated undo twice in a row', () => {
  function findLatestUndoable(entries: Array<{ undone: boolean; at: number; kind: string }>) {
    return entries
      .filter(e => !e.undone && e.kind === 'dated_change')
      .sort((a, b) => b.at - a.at)[0] ?? null;
  }

  it('removes exactly two versions then reports nothing left', () => {
    const entries = [
      { undone: false, at: 1000, kind: 'dated_change' },
      { undone: false, at: 2000, kind: 'dated_change' },
    ];
    const first = findLatestUndoable(entries)!;
    expect(first.at).toBe(2000);
    first.undone = true;

    const second = findLatestUndoable(entries)!;
    expect(second.at).toBe(1000);
    second.undone = true;

    expect(findLatestUndoable(entries)).toBeNull();
  });
});

// ── Payload whitelist ─────────────────────────────────────────────────────────

describe('payload whitelist', () => {
  const ALLOWED = [
    'mappingType', 'productId', 'productName', 'recipeId', 'recipeName',
    'servingMl', 'conversionRatio', 'servingType', 'conversionUnit',
  ];

  function whitelistPayload(raw: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const f of ALLOWED) {
      if (f in raw) out[f] = raw[f];
    }
    return out;
  }

  it('drops unknown fields', () => {
    const result = whitelistPayload({ mappingType: 'skipped', evil: 'hack' });
    expect('evil' in result).toBe(false);
    expect(result.mappingType).toBe('skipped');
  });

  it('only includes allowed field names', () => {
    const raw: Record<string, unknown> = { mappingType: 'skipped', evil: 'hack', extra: 123 };
    const result = whitelistPayload(raw);
    const resultKeys = Object.keys(result);
    for (const k of resultKeys) {
      expect(ALLOWED).toContain(k);
    }
  });

  it('keeps all allowed fields', () => {
    const raw = { mappingType: 'direct_product', productId: 'p1', productName: 'X', servingMl: 200 };
    const result = whitelistPayload(raw);
    expect(result.productId).toBe('p1');
    expect(result.servingMl).toBe(200);
  });

  it('drops extra fields not in allowlist', () => {
    const raw = { mappingType: 'skipped', notes: 'remove me', internalId: '123' };
    const result = whitelistPayload(raw);
    expect('notes' in result).toBe(false);
    expect('internalId' in result).toBe(false);
  });
});

// ── Per-key batch packing ─────────────────────────────────────────────────────

describe('per-key batch packing', () => {
  function packIntoBatches(keys: Array<{ key: string; opsNeeded: number }>, limit = 400) {
    const batches: Array<Array<{ key: string; opsNeeded: number }>> = [[]];
    let currentOps = 0;
    for (const k of keys) {
      if (currentOps + k.opsNeeded > limit) {
        batches.push([]);
        currentOps = 0;
      }
      batches[batches.length - 1].push(k);
      currentOps += k.opsNeeded;
    }
    return batches;
  }

  it('never splits a key across batches', () => {
    const keys = Array.from({ length: 150 }, (_, i) => ({ key: `k${i}`, opsNeeded: 3 }));
    const batches = packIntoBatches(keys);
    const allKeys = batches.flat().map(k => k.key);
    expect(allKeys).toHaveLength(150);
    for (const k of keys) {
      const count = batches.filter(b => b.some(x => x.key === k.key)).length;
      expect(count).toBe(1);
    }
  });

  it('each key appears exactly once across all batches', () => {
    const keys = Array.from({ length: 500 }, (_, i) => ({ key: `k${i}`, opsNeeded: 1 }));
    const batches = packIntoBatches(keys);
    const allKeys = batches.flat().map(k => k.key);
    expect(allKeys).toHaveLength(500);
    const unique = new Set(allKeys);
    expect(unique.size).toBe(500);
  });

  it('flushes before a key that would overflow', () => {
    // 399 ops used, next key needs 5 → must flush before
    const keys = [
      { key: 'big', opsNeeded: 399 },
      { key: 'overflow', opsNeeded: 5 },
    ];
    const batches = packIntoBatches(keys);
    expect(batches).toHaveLength(2);
    expect(batches[0][0].key).toBe('big');
    expect(batches[1][0].key).toBe('overflow');
  });
});

// ── Category undo restores exact values ──────────────────────────────────────

describe('category undo restores exact values', () => {
  it('restores per-product before values verbatim', () => {
    const changeEntry = {
      kind: 'merge' as const,
      products: [
        { id: 'p1', before: 'Red Wine' },
        { id: 'p2', before: 'red wine' },
        { id: 'p3', before: 'Wines' },
      ],
      venueListBefore: ['Red Wine', 'Beer'],
      status: 'applied',
      undone: false,
    };
    const restoreOps = changeEntry.products.map(p => ({ id: p.id, category: p.before }));
    expect(restoreOps).toHaveLength(3);
    expect(restoreOps.find(r => r.id === 'p2')?.category).toBe('red wine');
    expect(restoreOps.find(r => r.id === 'p3')?.category).toBe('Wines');
    expect(changeEntry.venueListBefore).toEqual(['Red Wine', 'Beer']);
  });

  it('handles empty products list (sync undo)', () => {
    const changeEntry = {
      kind: 'sync' as const,
      products: [] as Array<{ id: string; before: string }>,
      venueListBefore: ['Beer', 'Wine'],
      status: 'applied',
      undone: false,
    };
    const restoreOps = changeEntry.products.map(p => ({ id: p.id, category: p.before }));
    expect(restoreOps).toHaveLength(0);
    expect(changeEntry.venueListBefore).toEqual(['Beer', 'Wine']);
  });
});

// ── Applying records excluded from undo ───────────────────────────────────────

describe('applying records excluded from undo', () => {
  function findLatestForUndo(entries: Array<{ status: string; undone: boolean; at: number }>) {
    return entries
      .filter(e => e.status === 'applied' && !e.undone)
      .sort((a, b) => b.at - a.at)[0] ?? null;
  }

  it('only acts on applied non-undone entries', () => {
    const entries = [
      { status: 'applying', undone: false, at: 3000 },
      { status: 'applied', undone: false, at: 2000 },
      { status: 'applied', undone: true, at: 1000 },
    ];
    const result = findLatestForUndo(entries);
    expect(result?.at).toBe(2000);
  });

  it('returns null when only applying entries exist', () => {
    const entries = [
      { status: 'applying', undone: false, at: 3000 },
    ];
    expect(findLatestForUndo(entries)).toBeNull();
  });

  it('returns null when all applied entries are undone', () => {
    const entries = [
      { status: 'applied', undone: true, at: 2000 },
    ];
    expect(findLatestForUndo(entries)).toBeNull();
  });
});
