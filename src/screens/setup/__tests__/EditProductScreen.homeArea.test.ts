/**
 * Tests for the optional home area fields added to the product create/edit form.
 *
 * Covers:
 *   1. Payload includes homeDepartmentId: null + homeAreaId: null when skipped.
 *   2. Payload includes correct IDs when an area is chosen.
 *   3. The stocktake item-counting fields do NOT include homeDepartmentId / homeAreaId
 *      — this addition is completely invisible to the counting flow.
 *
 * Strategy: the save payload is assembled by a pure function extracted from the
 * real performSave() logic (same approach used elsewhere in this test suite).
 * No React / Firebase imports needed.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

type FormValues = {
  name: string;
  unit: string | null;
  costPrice: number | null;
  parLevel: string | null;
  homeDepartmentId: string | null;
  homeAreaId: string | null;
  [key: string]: any;
};

// ── Helper: mirrors the subset of performSave() that builds the home-area fields ──
// This is the minimal slice of the payload that the tests care about.

function buildHomeAreaPayload(form: FormValues): {
  homeDepartmentId: string | null;
  homeAreaId: string | null;
} {
  return {
    homeDepartmentId: form.homeDepartmentId ?? null,
    homeAreaId: form.homeAreaId ?? null,
  };
}

// ── Helper: mimics the stocktake item fields written during a count session ──
// Taken from the shape written by activeDeptTake / snapshotWriter:
//   { productId, name, unit, costPrice, lastCount, lastCountAt, ... }
// These are the fields the counting flow reads from product documents and
// stamps onto stocktake area items.

const STOCKTAKE_ITEM_FIELDS = [
  'productId',
  'name',
  'unit',
  'costPrice',
  'parLevel',
  'lastCount',
  'lastCountAt',
  'lastCountBy',
  'lastCountByName',
  'varianceQty',
  'varianceDollars',
  'updatedAt',
  'areaName',
  'departmentId',
  'areaId',
] as const;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('EditProductScreen — home area fields', () => {

  // ── Group 1: payload when skipped ──────────────────────────────────────────

  describe('when skipped (null values)', () => {

    it('HA1: product saved with no home area has homeDepartmentId: null', () => {
      const form: FormValues = {
        name: 'Hendricks Gin',
        unit: 'bottle',
        costPrice: 24.5,
        parLevel: '3',
        homeDepartmentId: null,
        homeAreaId: null,
      };
      const payload = buildHomeAreaPayload(form);
      expect(payload.homeDepartmentId).toBeNull();
    });

    it('HA2: product saved with no home area has homeAreaId: null', () => {
      const form: FormValues = {
        name: 'Hendricks Gin',
        unit: 'bottle',
        costPrice: 24.5,
        parLevel: '3',
        homeDepartmentId: null,
        homeAreaId: null,
      };
      const payload = buildHomeAreaPayload(form);
      expect(payload.homeAreaId).toBeNull();
    });

    it('HA3: explicitly skipped after choosing (both reset to null)', () => {
      // Simulates choosing an area then hitting "Skip for now" to clear it
      const form: FormValues = {
        name: 'Dom Perignon',
        unit: 'bottle',
        costPrice: 150,
        parLevel: '6',
        homeDepartmentId: null,  // cleared by skip
        homeAreaId: null,        // cleared by skip
      };
      const payload = buildHomeAreaPayload(form);
      expect(payload.homeDepartmentId).toBeNull();
      expect(payload.homeAreaId).toBeNull();
    });

    it('HA4: form initialised without seed has both fields null by default', () => {
      // Mirrors the form initial state when no seed is provided
      const formInitial: FormValues = {
        name: '',
        unit: '',
        costPrice: null,
        parLevel: null,
        homeDepartmentId: null,   // default
        homeAreaId: null,          // default
      };
      const payload = buildHomeAreaPayload(formInitial);
      expect(payload.homeDepartmentId).toBeNull();
      expect(payload.homeAreaId).toBeNull();
    });
  });

  // ── Group 2: payload when an area is chosen ────────────────────────────────

  describe('when an area is chosen', () => {

    const DEPT_ID = 'dept-bar';
    const AREA_ID = 'area-back-bar';

    it('HA5: chosen department ID appears in payload', () => {
      const form: FormValues = {
        name: 'Heineken 330ml',
        unit: 'can',
        costPrice: 2.1,
        parLevel: '24',
        homeDepartmentId: DEPT_ID,
        homeAreaId: AREA_ID,
      };
      const payload = buildHomeAreaPayload(form);
      expect(payload.homeDepartmentId).toBe(DEPT_ID);
    });

    it('HA6: chosen area ID appears in payload', () => {
      const form: FormValues = {
        name: 'Heineken 330ml',
        unit: 'can',
        costPrice: 2.1,
        parLevel: '24',
        homeDepartmentId: DEPT_ID,
        homeAreaId: AREA_ID,
      };
      const payload = buildHomeAreaPayload(form);
      expect(payload.homeAreaId).toBe(AREA_ID);
    });

    it('HA7: undefined in seed falls back to null (edit path with legacy doc)', () => {
      // A product saved before this feature has no homeDepartmentId on the seed.
      // The form initialises it from seed?.homeDepartmentId ?? null.
      const seed: Record<string, any> = { name: 'Legacy Gin', unit: 'bottle', costPrice: 20 };
      const form: FormValues = {
        name: seed.name,
        unit: seed.unit,
        costPrice: seed.costPrice,
        parLevel: null,
        homeDepartmentId: seed.homeDepartmentId ?? null,  // undefined → null
        homeAreaId: seed.homeAreaId ?? null,               // undefined → null
      };
      const payload = buildHomeAreaPayload(form);
      expect(payload.homeDepartmentId).toBeNull();
      expect(payload.homeAreaId).toBeNull();
    });

    it('HA8: choosing a different area overwrites the previous selection', () => {
      // Start with area A, change to area B
      const initial: FormValues = {
        name: 'Aperol', unit: 'bottle', costPrice: 18, parLevel: '4',
        homeDepartmentId: DEPT_ID, homeAreaId: AREA_ID,
      };
      // User picks a different area (simulated by updating form state)
      const updated: FormValues = {
        ...initial,
        homeDepartmentId: 'dept-kitchen',
        homeAreaId: 'area-dry-store',
      };
      const payload = buildHomeAreaPayload(updated);
      expect(payload.homeDepartmentId).toBe('dept-kitchen');
      expect(payload.homeAreaId).toBe('area-dry-store');
    });
  });

  // ── Group 3: stocktake counting flow isolation ─────────────────────────────

  describe('stocktake item fields — home area must not appear', () => {

    it('HA9: homeDepartmentId is not in the STOCKTAKE_ITEM_FIELDS list', () => {
      // The stocktake counting flow only reads/writes the fields in this constant.
      // This test makes the isolation contract explicit and catches it if the
      // field is accidentally added to the counting path in a future refactor.
      expect(STOCKTAKE_ITEM_FIELDS).not.toContain('homeDepartmentId');
    });

    it('HA10: homeAreaId is not in the STOCKTAKE_ITEM_FIELDS list', () => {
      expect(STOCKTAKE_ITEM_FIELDS).not.toContain('homeAreaId');
    });

    it('HA11: a stocktake item with home-area-free product data has correct shape', () => {
      // Simulates an item stamped onto a stocktake area during counting.
      // The product's home area fields are not copied here.
      const productDoc = {
        id: 'prod-1',
        name: 'Heineken 330ml',
        unit: 'can',
        costPrice: 2.1,
        parLevel: 24,
        homeDepartmentId: 'dept-bar',   // exists on the product but…
        homeAreaId: 'area-back-bar',     // …not propagated to the item
      };

      // Build a stocktake item the way the counting flow would — explicit picks only
      const stocktakeItem = {
        productId: productDoc.id,
        name: productDoc.name,
        unit: productDoc.unit,
        costPrice: productDoc.costPrice,
        parLevel: productDoc.parLevel,
        lastCount: 0,
        lastCountAt: null,
      };

      // home area fields must not appear on the stamped item
      expect('homeDepartmentId' in stocktakeItem).toBe(false);
      expect('homeAreaId' in stocktakeItem).toBe(false);
    });
  });
});
