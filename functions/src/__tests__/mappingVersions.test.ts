import {
  reportDates,
  selectVersion,
  validateNewVersion,
  diffMappingVsVersion,
  applyVersionsToMappings,
  planChangeProduct,
  planUndoChange,
  MappingVersion,
  VersionMappingFields,
  MappingDocSnapshot,
} from '../mappingVersions';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeVersion(overrides: Partial<MappingVersion> & { id: string; effectiveFrom: string }): MappingVersion {
  return {
    mappingKey: 'test-key',
    posItemName: 'Test Key',
    mappingType: 'product',
    productId: 'prod1',
    productName: 'Product One',
    recipeId: null,
    recipeName: null,
    servingMl: null,
    conversionRatio: null,
    servingType: null,
    conversionUnit: null,
    createdAt: null,
    createdByUid: 'uid1',
    ...overrides,
  };
}

const fields1: VersionMappingFields = {
  mappingType: 'product', productId: 'prod1', productName: 'Product One',
  recipeId: null, recipeName: null, servingMl: null,
  conversionRatio: null, servingType: null, conversionUnit: null,
};

const fields2: VersionMappingFields = {
  mappingType: 'product', productId: 'prod2', productName: 'Product Two',
  recipeId: null, recipeName: null, servingMl: null,
  conversionRatio: null, servingType: null, conversionUnit: null,
};

// ── reportDates ───────────────────────────────────────────────────────────────

describe('reportDates', () => {
  it('returns a single date when start===end', () => {
    const dates = reportDates(new Date('2026-10-07T12:00:00Z'), new Date('2026-10-07T12:00:00Z'), 'UTC');
    expect(dates).toEqual(['2026-10-07']);
  });

  it('returns correct range over a week in UTC', () => {
    const dates = reportDates(new Date('2026-10-01T00:00:00Z'), new Date('2026-10-07T00:00:00Z'), 'UTC');
    expect(dates).toHaveLength(7);
    expect(dates[0]).toBe('2026-10-01');
    expect(dates[6]).toBe('2026-10-07');
  });

  it('handles month boundary', () => {
    const dates = reportDates(new Date('2026-10-30T00:00:00Z'), new Date('2026-11-02T00:00:00Z'), 'UTC');
    expect(dates).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
  });

  it('returns empty when start > end in timezone', () => {
    const dates = reportDates(new Date('2026-10-07T00:00:00Z'), new Date('2026-10-06T00:00:00Z'), 'UTC');
    expect(dates).toEqual([]);
  });

  it('handles New Zealand timezone (UTC+13 in summer)', () => {
    // 2026-10-07 12:00 UTC = 2026-10-08 01:00 NZDT (UTC+13) → NZ date is 2026-10-08
    // 2026-10-09 12:00 UTC = 2026-10-10 01:00 NZDT (UTC+13) → NZ date is 2026-10-10
    const start = new Date('2026-10-07T12:00:00Z');
    const end   = new Date('2026-10-09T12:00:00Z');
    const dates = reportDates(start, end, 'Pacific/Auckland');
    // NZ dates: 2026-10-08, 2026-10-09, 2026-10-10 (3 days)
    expect(dates[0]).toBe('2026-10-08');
    expect(dates).toHaveLength(3);
    expect(dates[0]).not.toBe('2026-10-07'); // not UTC date
  });

  it('caps at 400 dates', () => {
    const start = new Date('2020-01-01T00:00:00Z');
    const end   = new Date('2022-01-01T00:00:00Z');
    const dates = reportDates(start, end, 'UTC');
    expect(dates).toHaveLength(400);
  });
});

// ── selectVersion ─────────────────────────────────────────────────────────────

describe('selectVersion', () => {
  const v0 = makeVersion({ id: 'v0', effectiveFrom: '0000-01-01', ...fields1 });
  const v1 = makeVersion({ id: 'v1', effectiveFrom: '2026-10-07', ...fields2 });

  it('returns none for empty versions array', () => {
    const result = selectVersion([], ['2026-10-01']);
    expect(result).toEqual({ none: true });
  });

  it('single version covers all dates → single result', () => {
    const result = selectVersion([v0], ['2026-09-01', '2026-09-30']);
    expect(result).toEqual({ version: v0 });
  });

  it('two versions, all dates before change → uses v0', () => {
    const result = selectVersion([v0, v1], ['2026-10-01', '2026-10-06']);
    expect(result).toEqual({ version: v0 });
  });

  it('two versions, all dates on/after change → uses v1', () => {
    const result = selectVersion([v0, v1], ['2026-10-07', '2026-10-14']);
    expect(result).toEqual({ version: v1 });
  });

  it('two versions, dates straddle change → straddle with defaultVersionId = last-date version', () => {
    const result = selectVersion([v0, v1], ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08']);
    expect(result).toMatchObject({ straddle: expect.any(Array), defaultVersionId: 'v1' });
    if ('straddle' in result) {
      expect(result.straddle).toContain('v0');
      expect(result.straddle).toContain('v1');
    }
  });

  it('empty dates → returns most current version', () => {
    const result = selectVersion([v0, v1], []);
    expect(result).toEqual({ version: v1 });
  });

  it('v0 sentinel date (0000-01-01) always applies to all real dates', () => {
    const result = selectVersion([v0], ['2026-10-01', '2026-10-31']);
    expect(result).toEqual({ version: v0 });
  });
});

// ── validateNewVersion ────────────────────────────────────────────────────────

describe('validateNewVersion', () => {
  it('accepts a valid effectiveFrom', () => {
    expect(validateNewVersion([], '2026-10-07', '2026-10-27')).toEqual({ ok: true });
  });

  it('rejects future date', () => {
    const result = validateNewVersion([], '2030-01-01', '2026-10-27');
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('future') });
  });

  it('rejects bad format', () => {
    const result = validateNewVersion([], '07/10/2026', '2026-10-27');
    expect(result).toMatchObject({ ok: false });
  });

  it('rejects date not after latest version', () => {
    const v0 = makeVersion({ id: 'v0', effectiveFrom: '0000-01-01' });
    const v1 = makeVersion({ id: 'v1', effectiveFrom: '2026-10-07' });
    const result = validateNewVersion([v0, v1], '2026-10-07', '2026-10-27');
    expect(result).toMatchObject({ ok: false });
  });

  it('accepts date after latest version', () => {
    const v0 = makeVersion({ id: 'v0', effectiveFrom: '0000-01-01' });
    const v1 = makeVersion({ id: 'v1', effectiveFrom: '2026-10-07' });
    const result = validateNewVersion([v0, v1], '2026-10-20', '2026-10-27');
    expect(result).toEqual({ ok: true });
  });
});

// ── diffMappingVsVersion ──────────────────────────────────────────────────────

describe('diffMappingVsVersion', () => {
  it('equal gives no-op (returns false)', () => {
    const parent: Record<string, unknown> = { ...fields1 };
    expect(diffMappingVsVersion(parent, fields1)).toBe(false);
  });

  it('different productId returns true', () => {
    const parent: Record<string, unknown> = { ...fields1, productId: 'prod999' };
    expect(diffMappingVsVersion(parent, fields1)).toBe(true);
  });

  it('unversioned key (empty latest) — null vs null is equal', () => {
    const parent: Record<string, unknown> = {};
    const latest: VersionMappingFields = {
      mappingType: null, productId: null, productName: null,
      recipeId: null, recipeName: null, servingMl: null,
      conversionRatio: null, servingType: null, conversionUnit: null,
    };
    expect(diffMappingVsVersion(parent, latest)).toBe(false);
  });

  it('effectiveFrom is never compared (not in MAPPING_FIELDS)', () => {
    // effectiveFrom is not a tracked field — should not cause a diff
    const parent: Record<string, unknown> = { ...fields1, effectiveFrom: '1900-01-01' };
    const latest = { ...fields1, effectiveFrom: '2026-10-07' } as unknown as VersionMappingFields;
    expect(diffMappingVsVersion(parent, latest)).toBe(false);
  });
});

// ── applyVersionsToMappings ───────────────────────────────────────────────────

describe('applyVersionsToMappings', () => {
  const v0 = makeVersion({ id: 'v0', effectiveFrom: '0000-01-01', mappingKey: 'wine', posItemName: 'Wine', ...fields1 });
  const v1 = makeVersion({ id: 'v1', effectiveFrom: '2026-10-07', mappingKey: 'wine', posItemName: 'Wine', ...fields2 });

  const baseMappings = {
    wine: { id: 'wine_csv', posItemName: 'Wine', posSystem: 'csv', ...fields1 } as any,
    beer: { id: 'beer_csv', posItemName: 'Beer', posSystem: 'csv', productId: 'beerProd', mappingType: 'product' } as any,
  };

  it('unversioned key output is byte-identical (beer unchanged)', () => {
    const { versionedFullMappings } = applyVersionsToMappings(
      baseMappings, { beer: 'beerProd' }, { wine: [v0, v1] }, ['2026-10-08'], {}
    );
    expect(versionedFullMappings['beer']).toEqual(baseMappings['beer']);
  });

  it('versioned key after change date uses v1 fields', () => {
    const { versionedFullMappings, versionedConfirmedMappings } = applyVersionsToMappings(
      baseMappings, { wine: 'prod1' }, { wine: [v0, v1] }, ['2026-10-08', '2026-10-09'], {}
    );
    expect(versionedFullMappings['wine'].productId).toBe('prod2');
    expect(versionedConfirmedMappings['wine']).toBe('prod2');
  });

  it('versioned key before change date uses v0 fields', () => {
    const { versionedFullMappings } = applyVersionsToMappings(
      baseMappings, { wine: 'prod1' }, { wine: [v0, v1] }, ['2026-10-05', '2026-10-06'], {}
    );
    expect(versionedFullMappings['wine'].productId).toBe('prod1');
  });

  it('straddle uses override if provided', () => {
    const { versionedFullMappings, versionInfoPerKey } = applyVersionsToMappings(
      baseMappings, { wine: 'prod1' }, { wine: [v0, v1] },
      ['2026-10-06', '2026-10-08'], { wine: 'v0' }
    );
    expect(versionedFullMappings['wine'].productId).toBe('prod1');
    expect(versionInfoPerKey['wine'].straddle?.overridden).toBe(true);
  });

  it('straddle defaults to last-date version when no override', () => {
    const { versionedFullMappings, versionInfoPerKey } = applyVersionsToMappings(
      baseMappings, { wine: 'prod1' }, { wine: [v0, v1] },
      ['2026-10-06', '2026-10-08'], {}
    );
    expect(versionedFullMappings['wine'].productId).toBe('prod2'); // v1 is last-date version
    expect(versionInfoPerKey['wine'].straddle?.overridden).toBe(false);
  });
});

// ── planChangeProduct ─────────────────────────────────────────────────────────

describe('planChangeProduct', () => {
  const baseDoc: MappingDocSnapshot = {
    id: 'wine_csv',
    posItemName: 'Wine',
    posSystem: 'csv',
    productId: 'prod1',
    productName: 'Product One',
    mappingType: 'product',
  };

  it('creates v0 + new version + updates parent when no existing versions', () => {
    const result = planChangeProduct({
      venueId: 'v1', posItemName: 'Wine', mappingKey: 'wine',
      effectiveFrom: '2026-10-07', newFields: fields2,
      existingMappingDocs: [baseDoc], existingVersions: [],
      newVersionId: 'newVer', v0Id: 'v0ver', uid: 'user1', todayStr: '2026-10-27',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.v0Created).toBe(true);
    const paths = result.writes.map(w => w.path);
    expect(paths).toContain('venues/v1/posMappingVersions/v0ver');
    expect(paths).toContain('venues/v1/posMappingVersions/newVer');
    expect(paths).toContain('venues/v1/posProductMappings/wine_csv');

    const v0Write = result.writes.find(w => w.kind === 'set' && w.path.endsWith('/v0ver'))!;
    expect((v0Write as any).data.effectiveFrom).toBe('0000-01-01');
    expect((v0Write as any).data.productId).toBe('prod1'); // v0 captures current state

    const newVerWrite = result.writes.find(w => w.kind === 'set' && w.path.endsWith('/newVer'))!;
    expect((newVerWrite as any).data.effectiveFrom).toBe('2026-10-07');
    expect((newVerWrite as any).data.productId).toBe('prod2');

    const parentWrite = result.writes.find(w => w.kind === 'set' && w.path.includes('/posProductMappings/'))!;
    expect((parentWrite as any).data.productId).toBe('prod2');
  });

  it('does not create v0 when versions already exist', () => {
    const v0 = makeVersion({ id: 'v0', effectiveFrom: '0000-01-01' });
    const result = planChangeProduct({
      venueId: 'v1', posItemName: 'Wine', mappingKey: 'wine',
      effectiveFrom: '2026-10-27', newFields: fields2,
      existingMappingDocs: [baseDoc], existingVersions: [v0],
      newVersionId: 'newVer', v0Id: 'v0ver', uid: 'user1', todayStr: '2026-10-27',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.v0Created).toBe(false);
    const paths = result.writes.map(w => w.path);
    expect(paths).not.toContain('venues/v1/posMappingVersions/v0ver');
  });

  it('consolidates duplicate mapping docs — deletes non-canonical', () => {
    const dupDoc: MappingDocSnapshot = { id: 'random-legacy-id', posItemName: 'Wine', posSystem: 'csv' };
    const result = planChangeProduct({
      venueId: 'v1', posItemName: 'Wine', mappingKey: 'wine',
      effectiveFrom: '2026-10-07', newFields: fields2,
      existingMappingDocs: [baseDoc, dupDoc], existingVersions: [],
      newVersionId: 'newVer', v0Id: 'v0ver', uid: 'user1', todayStr: '2026-10-27',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const deleteOps = result.writes.filter(w => w.kind === 'delete');
    expect(deleteOps).toHaveLength(1);
    expect(deleteOps[0].path).toContain('random-legacy-id');
  });

  it('rejects effectiveFrom in the future', () => {
    const result = planChangeProduct({
      venueId: 'v1', posItemName: 'Wine', mappingKey: 'wine',
      effectiveFrom: '2030-01-01', newFields: fields2,
      existingMappingDocs: [baseDoc], existingVersions: [],
      newVersionId: 'newVer', v0Id: 'v0ver', uid: 'user1', todayStr: '2026-10-27',
    });
    expect(result.ok).toBe(false);
  });

  it('creates new mapping doc when no existing docs', () => {
    const result = planChangeProduct({
      venueId: 'v1', posItemName: 'Andre Clouet', mappingKey: 'andre clouet',
      effectiveFrom: '2026-10-07', newFields: fields2,
      existingMappingDocs: [], existingVersions: [],
      newVersionId: 'newVer', v0Id: 'v0ver', uid: 'user1', todayStr: '2026-10-27',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parentWrite = result.writes.find(w => w.kind === 'set' && w.path.includes('/posProductMappings/'))!;
    expect(parentWrite).toBeDefined();
    expect((parentWrite as any).path).toContain('andre_clouet_csv');
  });
});

// ── planUndoChange ────────────────────────────────────────────────────────────

describe('planUndoChange', () => {
  const doc: MappingDocSnapshot = {
    id: 'wine_csv', posItemName: 'Wine', posSystem: 'csv', ...fields2,
  };
  const v0 = makeVersion({ id: 'v0', effectiveFrom: '0000-01-01', ...fields1 });
  const v1 = makeVersion({ id: 'v1', effectiveFrom: '2026-10-07', ...fields2 });

  it('errors when no versions to undo', () => {
    const result = planUndoChange({ venueId: 'v1', posItemName: 'Wine', existingMappingDocs: [doc], existingVersions: [] });
    expect(result.ok).toBe(false);
  });

  it('errors when only v0 exists (cannot undo v0)', () => {
    const result = planUndoChange({ venueId: 'v1', posItemName: 'Wine', existingMappingDocs: [doc], existingVersions: [v0] });
    expect(result.ok).toBe(false);
  });

  it('undo with only v0+v1 → deletes both, back to unversioned', () => {
    const result = planUndoChange({ venueId: 'v1', posItemName: 'Wine', existingMappingDocs: [doc], existingVersions: [v0, v1] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.restoredToUnversioned).toBe(true);
    const deleteOps = result.writes.filter(w => w.kind === 'delete' && w.path.includes('/posMappingVersions/'));
    expect(deleteOps).toHaveLength(2); // both v0 and v1 deleted
    // Parent restored to v0 fields (prod1)
    const parentWrite = result.writes.find(w => w.kind === 'set' && w.path.includes('/posProductMappings/'));
    expect((parentWrite as any)?.data.productId).toBe('prod1');
  });

  it('undo with v0+v1+v2 → deletes only v2, restores to v1 fields', () => {
    const v2 = makeVersion({ id: 'v2', effectiveFrom: '2026-10-20', ...fields1 });
    const result = planUndoChange({ venueId: 'v1', posItemName: 'Wine', existingMappingDocs: [doc], existingVersions: [v0, v1, v2] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.restoredToUnversioned).toBe(false);
    const deleteOps = result.writes.filter(w => w.kind === 'delete' && w.path.includes('/posMappingVersions/'));
    expect(deleteOps).toHaveLength(1);
    expect(deleteOps[0].path).toContain('v2');
    const parentWrite = result.writes.find(w => w.kind === 'set' && w.path.includes('/posProductMappings/'));
    expect((parentWrite as any)?.data.productId).toBe('prod2'); // v1 fields
  });
});
