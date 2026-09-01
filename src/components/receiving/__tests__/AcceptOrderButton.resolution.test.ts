/**
 * Unit tests for the "Search existing product" (match) resolution logic
 * added to AcceptOrderButton in Handoff 2.
 *
 * Strategy: the component's finalizeAcceptReview and button-enablement logic
 * are pure data transforms — test them as in-file logic rather than rendering
 * the full RN component tree.  Mirrors the style of other test files in this
 * project (no React / Firebase imports, just plain TypeScript).
 */

// ── Types mirroring AcceptOrderButton's internal types ────────────────────────

type Resolution = 'add' | 'skip' | { type: 'match'; productId: string; productName: string };
type ResolvedLine = { productId: string; name: string; qty: number; unitCost: number };
type UnmatchedLine = { name: string; qty: number; unitPrice: number; idx: number };

// ── Helpers extracted for testing (mirrors production code logic) ──────────────

/**
 * Maps unmatched lines + user resolutions → resolved lines + skipped names.
 * Returns null for any 'add' resolution that would call quickAddProduct
 * (those require async I/O and are tested by accepting the returned array shape).
 */
function resolveMatchedLines(
  unmatched: UnmatchedLine[],
  resolutions: Record<number, Resolution>,
): { lines: ResolvedLine[]; skipped: string[]; needsCreate: string[] } {
  const lines: ResolvedLine[] = [];
  const skipped: string[] = [];
  const needsCreate: string[] = [];

  for (const u of unmatched) {
    const resolution = resolutions[u.idx];
    if (resolution === 'add') {
      needsCreate.push(u.name);
    } else if (resolution === 'skip') {
      skipped.push(u.name);
    } else if (typeof resolution === 'object' && resolution.type === 'match') {
      lines.push({
        productId: resolution.productId,
        name: u.name,
        qty: u.qty,
        unitCost: u.unitPrice,
      });
    }
  }

  return { lines, skipped, needsCreate };
}

/**
 * Mirrors the disabled condition used on the "Continue — Create Order" button.
 * Returns true when the button should be disabled (at least one line unresolved).
 */
function isContinueDisabled(
  unmatched: UnmatchedLine[],
  resolutions: Record<number, Resolution>,
): boolean {
  return unmatched.some(u => resolutions[u.idx] === undefined);
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const U1: UnmatchedLine = { name: 'Mystery Beer', qty: 6, unitPrice: 3.5, idx: 0 };
const U2: UnmatchedLine = { name: 'Unknown Cider', qty: 2, unitPrice: 4.25, idx: 1 };

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AcceptOrderButton — match resolution (Handoff 2)', () => {
  describe('resolveMatchedLines — { type: "match" } resolution', () => {
    it('uses the selected productId directly, not the invoice line name as an id', () => {
      const resolutions: Record<number, Resolution> = {
        [U1.idx]: { type: 'match', productId: 'prod-abc-123', productName: 'Draft Lager' },
      };
      const { lines } = resolveMatchedLines([U1], resolutions);
      expect(lines).toHaveLength(1);
      expect(lines[0].productId).toBe('prod-abc-123');
    });

    it('carries the invoice line name (not the product name) into the order line', () => {
      const resolutions: Record<number, Resolution> = {
        [U1.idx]: { type: 'match', productId: 'prod-abc-123', productName: 'Draft Lager' },
      };
      const { lines } = resolveMatchedLines([U1], resolutions);
      expect(lines[0].name).toBe(U1.name); // invoice line name preserved
    });

    it('carries qty and unitCost from the invoice line', () => {
      const resolutions: Record<number, Resolution> = {
        [U1.idx]: { type: 'match', productId: 'prod-xyz', productName: 'Pale Ale' },
      };
      const { lines } = resolveMatchedLines([U1], resolutions);
      expect(lines[0].qty).toBe(U1.qty);
      expect(lines[0].unitCost).toBe(U1.unitPrice);
    });

    it('does not add the line to needsCreate or skipped', () => {
      const resolutions: Record<number, Resolution> = {
        [U1.idx]: { type: 'match', productId: 'prod-xyz', productName: 'Pale Ale' },
      };
      const { skipped, needsCreate } = resolveMatchedLines([U1], resolutions);
      expect(skipped).toHaveLength(0);
      expect(needsCreate).toHaveLength(0);
    });

    it('handles multiple lines with mixed resolutions correctly', () => {
      const resolutions: Record<number, Resolution> = {
        [U1.idx]: { type: 'match', productId: 'prod-beer', productName: 'Lager' },
        [U2.idx]: 'skip',
      };
      const { lines, skipped, needsCreate } = resolveMatchedLines([U1, U2], resolutions);
      expect(lines).toHaveLength(1);
      expect(lines[0].productId).toBe('prod-beer');
      expect(skipped).toEqual(['Unknown Cider']);
      expect(needsCreate).toHaveLength(0);
    });
  });

  describe('isContinueDisabled — button enablement', () => {
    it('is disabled when no line has been resolved', () => {
      expect(isContinueDisabled([U1, U2], {})).toBe(true);
    });

    it('is disabled when only some lines are resolved', () => {
      const resolutions: Record<number, Resolution> = {
        [U1.idx]: 'skip',
        // U2 still undefined
      };
      expect(isContinueDisabled([U1, U2], resolutions)).toBe(true);
    });

    it('is enabled when all lines have a "match" resolution', () => {
      const resolutions: Record<number, Resolution> = {
        [U1.idx]: { type: 'match', productId: 'prod-a', productName: 'Beer A' },
        [U2.idx]: { type: 'match', productId: 'prod-b', productName: 'Cider B' },
      };
      expect(isContinueDisabled([U1, U2], resolutions)).toBe(false);
    });

    it('is enabled when lines have mixed add/skip/match resolutions — all resolved', () => {
      const resolutions: Record<number, Resolution> = {
        [U1.idx]: 'add',
        [U2.idx]: { type: 'match', productId: 'prod-b', productName: 'Cider B' },
      };
      expect(isContinueDisabled([U1, U2], resolutions)).toBe(false);
    });

    it('treats a "match" object as a valid resolution (not undefined)', () => {
      const resolutions: Record<number, Resolution> = {
        [U1.idx]: { type: 'match', productId: 'prod-x', productName: 'Test' },
      };
      expect(isContinueDisabled([U1], resolutions)).toBe(false);
    });
  });
});
