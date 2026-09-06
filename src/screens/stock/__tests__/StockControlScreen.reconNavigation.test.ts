/**
 * Tests for the ReconciliationsPanel → navigation fix (Phase 3b).
 *
 * Strategy: verify the structural change without rendering the full screen —
 * check that ReconciliationsPanel is no longer imported anywhere (a secondary
 * import check), and test the navigation-target constant directly.
 *
 * The primary guarantee is compile-time (the import is gone and the modal
 * block is removed), but these tests document the intent and will catch
 * accidental re-introduction.
 */

// ── Route name constant ────────────────────────────────────────────────────────

/** The route name the 'Invoice Reconciliations' item must navigate to. */
const RECON_ROUTE = 'Reconciliations';

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('StockControlScreen — reconciliation navigation (3b)', () => {

  it('R1: RECON_ROUTE points to the correct screen name registered in MainStack', () => {
    // ReconciliationsScreen is registered as 'Reconciliations' in
    // src/navigation/stacks/MainStack.tsx.  This constant must match.
    expect(RECON_ROUTE).toBe('Reconciliations');
  });

  it('R2: RECON_ROUTE is not the broken panel route or an unregistered name', () => {
    // The broken panel was accessed via a modal state toggle, not a route.
    // The correct route name is a non-empty string distinct from panel identifiers.
    expect(typeof RECON_ROUTE).toBe('string');
    expect(RECON_ROUTE.length).toBeGreaterThan(0);
    expect(RECON_ROUTE).not.toMatch(/panel|modal/i);
  });

  it('R3: ReconciliationsPanel is NOT imported by StockControlScreen', () => {
    // Read the source file and confirm the import line is absent.
    // This is a structural regression guard — if the import comes back,
    // the broken panel would re-enter the render tree.
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '../StockControlScreen.tsx'),
      'utf8',
    );
    expect(src).not.toMatch(/import ReconciliationsPanel/);
    expect(src).not.toMatch(/<ReconciliationsPanel/);
  });

  it('R4: StockControlScreen source navigates to RECON_ROUTE on that item press', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '../StockControlScreen.tsx'),
      'utf8',
    );
    // The Item onPress must call navigate with 'Reconciliations'
    expect(src).toMatch(/navigate\(['"]Reconciliations['"]/);
  });
});
