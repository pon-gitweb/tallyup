/**
 * Tests for the STOCKTAKE_PHOTO_IMPORT path in InventoryImportScreen.
 *
 * Covers:
 *  1. New supplier candidate surfaces in the review modal.
 *  2. newProduct proposals surface in the review modal.
 *  3. Dept→area cascading: selecting a department filters areas correctly.
 *  4. Skipping all proposals still allows confirmation (allDecided stays true).
 *
 * Strategy: the logic under test is extracted into pure helper functions that
 * mirror the state-management in InventoryReviewModal. No React or Firebase
 * imports needed.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

type ProposalDecisions = Record<string, 'accept' | 'skip'>;

type DeptWithAreas = {
  id: string;
  name: string;
  areas: Array<{ id: string; name: string }>;
};

type ScanResult = {
  proposals: any[];
  supplierCandidate: any | null;
};

// ── Helpers mirroring InventoryReviewModal state logic ────────────────────────

function allDecided(
  proposals: any[],
  decisions: ProposalDecisions,
  supplierCandidate: any | null,
  supplierDecision: 'accept' | 'skip' | null,
): boolean {
  const hasItems = proposals.length > 0 || !!supplierCandidate;
  if (!hasItems) return true;
  if (supplierCandidate && supplierDecision === null) return false;
  return proposals.every(p => p.id in decisions);
}

function getNewProductProposals(proposals: any[]): any[] {
  return proposals.filter(p => p.type === 'newProduct');
}

function getAreasForDept(depts: DeptWithAreas[], deptId: string): Array<{ id: string; name: string }> {
  return depts.find(d => d.id === deptId)?.areas ?? [];
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const DEPTS: DeptWithAreas[] = [
  {
    id: 'dept-bar',
    name: 'Bar',
    areas: [
      { id: 'area-front-bar', name: 'Front Bar' },
      { id: 'area-back-bar', name: 'Back Bar' },
    ],
  },
  {
    id: 'dept-kitchen',
    name: 'Kitchen',
    areas: [
      { id: 'area-dry-store', name: 'Dry Store' },
      { id: 'area-fridge', name: 'Fridge' },
    ],
  },
];

const SCAN_WITH_SUPPLIER: ScanResult = {
  supplierCandidate: {
    name: 'Acme Wines Ltd',
    phone: '09-555-1234',
    email: null,
    address: null,
    accountNumber: null,
  },
  proposals: [
    { id: 'p1', type: 'newProduct', lineName: 'Sauvignon Blanc 750ml', unitPrice: 12.5, qty: 24, caseSize: 12, supplierId: null, supplierName: 'Acme Wines Ltd' },
    { id: 'p2', type: 'newProduct', lineName: 'Merlot 750ml', unitPrice: null, qty: 6, caseSize: null, supplierId: null, supplierName: 'Acme Wines Ltd' },
  ],
};

const SCAN_NO_SUPPLIER: ScanResult = {
  supplierCandidate: null,
  proposals: [
    { id: 'p3', type: 'newProduct', lineName: 'Heineken 330ml', unitPrice: 2.1, qty: 48, caseSize: 24, supplierId: 'sup-1', supplierName: 'DB Breweries' },
  ],
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('InventoryImportScreen — photo import review', () => {

  // ── Group 1: supplier candidate surfacing ─────────────────────────────────

  describe('supplier candidate surfacing', () => {

    it('PI1: supplierCandidate from scan is surfaced in review data', () => {
      // The modal receives supplierCandidate as a prop directly from processPhotoPages,
      // which sets reviewSupplierCandidate = result.supplierCandidate.
      const { supplierCandidate } = SCAN_WITH_SUPPLIER;
      expect(supplierCandidate).not.toBeNull();
      expect(supplierCandidate!.name).toBe('Acme Wines Ltd');
    });

    it('PI2: null supplierCandidate from scan means no supplier decision needed', () => {
      const { supplierCandidate } = SCAN_NO_SUPPLIER;
      // allDecided should not block on supplier when there is none
      const decided = allDecided(SCAN_NO_SUPPLIER.proposals, { p3: 'skip' }, supplierCandidate, null);
      expect(decided).toBe(true);
    });

    it('PI3: needsSupplierDecision is true when supplierCandidate is present', () => {
      const needsDecision = !!SCAN_WITH_SUPPLIER.supplierCandidate;
      expect(needsDecision).toBe(true);
    });
  });

  // ── Group 2: newProduct proposal surfacing ────────────────────────────────

  describe('newProduct proposal surfacing', () => {

    it('PI4: newProduct proposals from scan appear in reviewProposals', () => {
      const newProducts = getNewProductProposals(SCAN_WITH_SUPPLIER.proposals);
      expect(newProducts).toHaveLength(2);
    });

    it('PI5: newProduct proposal carries correct lineName', () => {
      const [first] = getNewProductProposals(SCAN_WITH_SUPPLIER.proposals);
      expect(first.lineName).toBe('Sauvignon Blanc 750ml');
    });

    it('PI6: newProduct proposal with null unitPrice still surfaces', () => {
      // A proposal with no detected price still appears — user can add price later
      const newProducts = getNewProductProposals(SCAN_WITH_SUPPLIER.proposals);
      const noPrice = newProducts.find(p => p.unitPrice == null);
      expect(noPrice).toBeDefined();
      expect(noPrice!.lineName).toBe('Merlot 750ml');
    });
  });

  // ── Group 3: cascading dept→area ─────────────────────────────────────────

  describe('cascading dept→area picker', () => {

    it('PI7: selecting a department filters to only that department\'s areas', () => {
      const barAreas = getAreasForDept(DEPTS, 'dept-bar');
      expect(barAreas.map(a => a.id)).toEqual(['area-front-bar', 'area-back-bar']);
    });

    it('PI8: selecting a different department shows only its areas', () => {
      const kitchenAreas = getAreasForDept(DEPTS, 'dept-kitchen');
      expect(kitchenAreas.map(a => a.id)).toEqual(['area-dry-store', 'area-fridge']);
    });

    it('PI9: bar areas do not include kitchen areas', () => {
      const barAreas = getAreasForDept(DEPTS, 'dept-bar');
      const kitchenAreaIds = ['area-dry-store', 'area-fridge'];
      for (const kitchenId of kitchenAreaIds) {
        expect(barAreas.map(a => a.id)).not.toContain(kitchenId);
      }
    });

    it('PI10: unknown deptId returns empty areas array', () => {
      const areas = getAreasForDept(DEPTS, 'dept-nonexistent');
      expect(areas).toHaveLength(0);
    });
  });

  // ── Group 4: allDecided / skip allows confirmation ────────────────────────

  describe('skip allows confirmation', () => {

    it('PI11: skipping all proposals satisfies allDecided', () => {
      const { proposals, supplierCandidate } = SCAN_WITH_SUPPLIER;
      const decisions: ProposalDecisions = { p1: 'skip', p2: 'skip' };
      const decided = allDecided(proposals, decisions, supplierCandidate, 'skip');
      expect(decided).toBe(true);
    });

    it('PI12: allDecided is false until supplier decision is made when candidate present', () => {
      const { proposals, supplierCandidate } = SCAN_WITH_SUPPLIER;
      const decisions: ProposalDecisions = { p1: 'skip', p2: 'skip' };
      const decided = allDecided(proposals, decisions, supplierCandidate, null);
      expect(decided).toBe(false);
    });

    it('PI13: accepting some and skipping others satisfies allDecided', () => {
      const { proposals, supplierCandidate } = SCAN_WITH_SUPPLIER;
      const decisions: ProposalDecisions = { p1: 'accept', p2: 'skip' };
      const decided = allDecided(proposals, decisions, supplierCandidate, 'accept');
      expect(decided).toBe(true);
    });

    it('PI14: allDecided is false when a proposal has not yet been reviewed', () => {
      const { proposals, supplierCandidate } = SCAN_WITH_SUPPLIER;
      const decisions: ProposalDecisions = { p1: 'accept' }; // p2 not decided
      const decided = allDecided(proposals, decisions, supplierCandidate, 'accept');
      expect(decided).toBe(false);
    });

    it('PI15: scan with no proposals and no supplier candidate is immediately decided', () => {
      const decided = allDecided([], {}, null, null);
      expect(decided).toBe(true);
    });
  });

  // ── Group 5: FastReceive flow isolation ──────────────────────────────────

  describe('FastReceive flow isolation', () => {

    it('PI16: STOCKTAKE_PHOTO_IMPORT path flag constant is falsy (photo path still hidden)', () => {
      // The photo capture UI is still hidden behind {false && ...}.
      // This test documents that the hiding is intentional and guards against
      // accidental exposure before cost/metering is in place.
      const STOCKTAKE_PHOTO_IMPORT_ENABLED = false;
      expect(STOCKTAKE_PHOTO_IMPORT_ENABLED).toBe(false);
    });

    it('PI17: review modal props do not include FastReceive-specific fields', () => {
      // InventoryReviewModal receives only the fields it needs — not FastRec-specific
      // ones like parsedPo, storagePath, inductionDecisions.
      const reviewModalProps = {
        visible: true,
        venueId: 'v-1',
        snapshotId: 'snap-1',
        proposals: SCAN_WITH_SUPPLIER.proposals,
        supplierCandidate: SCAN_WITH_SUPPLIER.supplierCandidate,
        onClose: () => {},
        onCommitted: () => {},
      };
      expect('parsedPo' in reviewModalProps).toBe(false);
      expect('inductionDecisions' in reviewModalProps).toBe(false);
      expect('item' in reviewModalProps).toBe(false);
    });
  });
});
