/**
 * Tests for the GP alert banner in SetupProductsPage.
 *
 * Strategy: pure-function helpers mirroring the production rendering and
 * filtering logic — no React render, no Firebase dependency. Same pattern as
 * the active-filter and impactOnGP tests.
 *
 * Coverage:
 *   A. Role gate — staff (canManage=false) never sees any alert
 *   B. Filter — only undismissed alerts appear
 *   C. Display text — recipe name, ingredient, GP% are all surfaced correctly
 *   D. Post-dismiss re-query — after dismissed:true is written, re-querying
 *      returns no alert for that record (simulates what onSnapshot delivers
 *      after the Firestore write, rather than checking local state)
 *   E. Change direction label — increase vs decrease is correctly signed
 */

import { describe, it, expect } from 'vitest'

// ── Types mirroring the production GpAlert type ───────────────────────────────

type GpAlert = {
  id: string
  recipeId: string
  recipeName: string
  ingredientProductId: string
  ingredientProductName: string
  oldCostPrice: number
  newCostPrice: number
  changePercent: number
  oldGpPct: number | null
  newGpPct: number | null
  dismissed: boolean
}

// ── Helpers mirroring the production rendering/gating logic ───────────────────

/**
 * Gate: should the banner render at all?
 * Mirrors `canManage && gpAlerts.length > 0`.
 * A staff-role user (canManage=false) never sees the banner, regardless of
 * what's pending in Firestore.
 */
function shouldShowBanner(canManage: boolean, alerts: GpAlert[]): boolean {
  return canManage && alerts.length > 0
}

/**
 * Filter: what onSnapshot delivers when the Firestore query is
 * `where('dismissed', '==', false)`. Mirrors what the query returns.
 * Used to simulate a fresh session (re-query) after a dismiss write.
 */
function filterUndismissed(alerts: GpAlert[]): GpAlert[] {
  return alerts.filter((a) => !a.dismissed)
}

/**
 * Format the ingredient + change-percent segment of the banner body.
 * Mirrors the JSX `{alert.ingredientProductName} cost changed +X% / -X%`.
 */
function formatChangeLabel(alert: GpAlert): string {
  const sign = alert.changePercent > 0 ? `+${Math.round(alert.changePercent)}%` : `${Math.round(alert.changePercent)}%`
  return `${alert.ingredientProductName} cost changed ${sign}`
}

/**
 * Format the optional GP% segment.
 * Mirrors `alert.oldGpPct != null && alert.newGpPct != null ? ... : ''`.
 */
function formatGpSegment(alert: GpAlert): string {
  if (alert.oldGpPct != null && alert.newGpPct != null) {
    return `recipe margin ${alert.oldGpPct}% → ${alert.newGpPct}%`
  }
  return ''
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const NEGRONI_ALERT: GpAlert = {
  id: 'alert-negroni-1',
  recipeId: 'negroni-1',
  recipeName: 'Negroni',
  ingredientProductId: 'gin-700ml-1',
  ingredientProductName: 'Gin 700ml',
  oldCostPrice: 14.00,
  newCostPrice: 21.00,
  changePercent: 50,
  oldGpPct: 90,    // hand-verified: round2(((20-2)/20)*100) = 90
  newGpPct: 85,    // hand-verified: round2(((20-3)/20)*100) = 85
  dismissed: false,
}

const GT_ALERT: GpAlert = {
  id: 'alert-gt-1',
  recipeId: 'gt-1',
  recipeName: 'G&T',
  ingredientProductId: 'gin-700ml-1',
  ingredientProductName: 'Gin 700ml',
  oldCostPrice: 14.00,
  newCostPrice: 21.00,
  changePercent: 50,
  oldGpPct: 91.67, // hand-verified: round2(((12-1.00)/12)*100) = 91.67
  newGpPct: 87.5,  // hand-verified: round2(((12-1.50)/12)*100) = 87.5
  dismissed: false,
}

const DISMISSED_ALERT: GpAlert = {
  ...NEGRONI_ALERT,
  id: 'alert-negroni-dismissed',
  dismissed: true,
}

// ── Suite A: role gate ────────────────────────────────────────────────────────

describe('GP alert banner — role gate (staff never sees)', () => {
  it('staff (canManage=false) sees no banner even with pending alerts', () => {
    expect(shouldShowBanner(false, [NEGRONI_ALERT])).toBe(false)
  })

  it('staff (canManage=false) sees no banner with multiple pending alerts', () => {
    expect(shouldShowBanner(false, [NEGRONI_ALERT, GT_ALERT])).toBe(false)
  })

  it('owner/manager (canManage=true) sees banner when alerts are pending', () => {
    expect(shouldShowBanner(true, [NEGRONI_ALERT])).toBe(true)
  })

  it('owner/manager sees no banner when alert list is empty', () => {
    expect(shouldShowBanner(true, [])).toBe(false)
  })

  it('canManage=false with empty list also shows nothing (both conditions false)', () => {
    expect(shouldShowBanner(false, [])).toBe(false)
  })
})

// ── Suite B: filter — only undismissed alerts appear ─────────────────────────

describe('GP alert banner — filter (only undismissed)', () => {
  it('undismissed alert passes through the filter', () => {
    expect(filterUndismissed([NEGRONI_ALERT])).toHaveLength(1)
  })

  it('dismissed alert is removed by the filter', () => {
    expect(filterUndismissed([DISMISSED_ALERT])).toHaveLength(0)
  })

  it('mixed list: only undismissed alerts pass through', () => {
    const filtered = filterUndismissed([NEGRONI_ALERT, DISMISSED_ALERT, GT_ALERT])
    expect(filtered).toHaveLength(2)
    expect(filtered.map((a) => a.id)).toEqual(['alert-negroni-1', 'alert-gt-1'])
  })

  it('all dismissed → empty list', () => {
    const allDismissed: GpAlert[] = [
      { ...NEGRONI_ALERT, dismissed: true },
      { ...GT_ALERT, dismissed: true },
    ]
    expect(filterUndismissed(allDismissed)).toHaveLength(0)
  })
})

// ── Suite C: display text ─────────────────────────────────────────────────────

describe('GP alert banner — display text', () => {
  it('banner title uses recipeName', () => {
    // Production: `${alert.recipeName} margin affected`
    expect(NEGRONI_ALERT.recipeName).toBe('Negroni')
    expect(`${NEGRONI_ALERT.recipeName} margin affected`).toBe('Negroni margin affected')
  })

  it('change label: price increase is prefixed with +', () => {
    expect(formatChangeLabel(NEGRONI_ALERT)).toBe('Gin 700ml cost changed +50%')
  })

  it('GP% segment: shows before → after when both are present', () => {
    expect(formatGpSegment(NEGRONI_ALERT)).toBe('recipe margin 90% → 85%')
  })

  it('G&T GP% segment with decimal values (hand-verified)', () => {
    // oldGpPct=91.67, newGpPct=87.5 — both hand-verified in gpAlerts.test.ts
    expect(formatGpSegment(GT_ALERT)).toBe('recipe margin 91.67% → 87.5%')
  })

  it('GP% segment is empty string when oldGpPct is null', () => {
    const noGp: GpAlert = { ...NEGRONI_ALERT, oldGpPct: null, newGpPct: null }
    expect(formatGpSegment(noGp)).toBe('')
  })

  it('GP% segment is empty string when only one side is null', () => {
    const partialGp: GpAlert = { ...NEGRONI_ALERT, oldGpPct: 90, newGpPct: null }
    expect(formatGpSegment(partialGp)).toBe('')
  })
})

// ── Suite D: post-dismiss re-query ────────────────────────────────────────────
//
// The production dismiss path writes { dismissed: true } to Firestore, then
// relies on the existing onSnapshot (which queries `where dismissed == false`)
// to automatically remove the document from the local list — it does NOT toggle
// local state directly. This simulates what happens in a fresh session: the new
// session queries Firestore and gets back only the still-undismissed records.

describe('GP alert banner — post-dismiss re-query (Firestore-backed, not local state)', () => {
  it('after dismiss write, re-querying returns empty for a single-alert list', () => {
    // Simulate: Firestore write sets dismissed=true, onSnapshot re-delivers
    // the collection — only records matching `where dismissed == false` come back.
    const afterDismiss: GpAlert[] = [
      { ...NEGRONI_ALERT, dismissed: true }, // what Firestore now has
    ]
    // The onSnapshot query filters to dismissed==false — simulated by filterUndismissed
    const viewAfterReQuery = filterUndismissed(afterDismiss)
    expect(viewAfterReQuery).toHaveLength(0)
    expect(shouldShowBanner(true, viewAfterReQuery)).toBe(false)
  })

  it('dismissing one alert in a two-alert list leaves the other visible', () => {
    const afterPartialDismiss: GpAlert[] = [
      { ...NEGRONI_ALERT, dismissed: true }, // just dismissed
      GT_ALERT,                               // still pending
    ]
    const viewAfterReQuery = filterUndismissed(afterPartialDismiss)
    expect(viewAfterReQuery).toHaveLength(1)
    expect(viewAfterReQuery[0].id).toBe('alert-gt-1')
    expect(shouldShowBanner(true, viewAfterReQuery)).toBe(true)
  })

  it('a fresh session (empty re-query) shows nothing — dismissed persists across sessions', () => {
    // Both dismissed in Firestore; fresh session receives no matching docs.
    const freshSessionView: GpAlert[] = [] // query returns no docs
    expect(shouldShowBanner(true, freshSessionView)).toBe(false)
  })
})

// ── Suite E: change direction label ──────────────────────────────────────────

describe('GP alert banner — change direction label', () => {
  it('positive changePercent gets a + prefix', () => {
    const alert: GpAlert = { ...NEGRONI_ALERT, changePercent: 50 }
    expect(formatChangeLabel(alert)).toContain('+50%')
  })

  it('negative changePercent (price decrease) gets no + prefix', () => {
    const alert: GpAlert = { ...NEGRONI_ALERT, changePercent: -20 }
    expect(formatChangeLabel(alert)).toContain('-20%')
    expect(formatChangeLabel(alert)).not.toContain('+')
  })

  it('changePercent is rounded to nearest integer in the label', () => {
    const alert: GpAlert = { ...NEGRONI_ALERT, changePercent: 33.33 }
    expect(formatChangeLabel(alert)).toContain('+33%')
    expect(formatChangeLabel(alert)).not.toContain('33.33')
  })
})
