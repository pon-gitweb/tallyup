/**
 * Tests for the GP alert cascade — the second pass of onProductPriceChanged
 * that writes persisted notices (venues/{venueId}/gpAlerts) when a significant
 * ingredient price change degrades recipe margins beyond a venue-configured bar.
 *
 * All recipe GP% values are hand-verified using the cascade's own formula:
 *   estimatedGpPct = round2(((rrp - cogs) / rrp) * 100)
 *
 * Tests cover the pure exported helpers only — no Firestore mocking needed.
 * The trigger wiring (Firestore reads/writes in onProductPriceChanged) is not
 * exercised here; the pure helpers are the testable unit.
 *
 * Coverage:
 *   A. gpAlertDollarThreshold — preset → dollar mapping
 *   B. computeRecipeGpPct — recipe-level GP% formula, hand-verified
 *   C. buildGpAlertDocs — below threshold produces no notice (regression)
 *   D. buildGpAlertDocs — above threshold, correct attribution + hand-verified GP%
 *   E. buildGpAlertDocs — multiple recipes each get their own notice (not conflated)
 *   F. buildGpAlertDocs — dismissed/dismissedBy/dismissedAt fields on new alerts
 */

import {
  gpAlertDollarThreshold,
  computeRecipeGpPct,
  buildGpAlertDocs,
  RecipeImpact,
} from "../priceCascade";

// ── Suite A: gpAlertDollarThreshold ──────────────────────────────────────────

describe("gpAlertDollarThreshold", () => {
  it("'off' → null (alerts disabled)", () => {
    expect(gpAlertDollarThreshold("off")).toBeNull();
  });

  it("'significant' → $1.00 threshold", () => {
    expect(gpAlertDollarThreshold("significant")).toBe(1.00);
  });

  it("'moderate' → $0.20 threshold (the recommended default)", () => {
    expect(gpAlertDollarThreshold("moderate")).toBe(0.20);
  });

  it("'small' → $0.05 threshold", () => {
    expect(gpAlertDollarThreshold("small")).toBe(0.05);
  });

  it("null (absent from venue doc) → $0.20 (same default as 'moderate')", () => {
    expect(gpAlertDollarThreshold(null)).toBe(0.20);
  });

  it("undefined → $0.20", () => {
    expect(gpAlertDollarThreshold(undefined)).toBe(0.20);
  });

  it("unknown string → $0.20 (safe default)", () => {
    expect(gpAlertDollarThreshold("something-new")).toBe(0.20);
  });

  it("thresholds are strictly ordered: small < moderate < significant", () => {
    const small = gpAlertDollarThreshold("small")!;
    const moderate = gpAlertDollarThreshold("moderate")!;
    const significant = gpAlertDollarThreshold("significant")!;
    expect(small).toBeLessThan(moderate);
    expect(moderate).toBeLessThan(significant);
  });
});

// ── Suite B: computeRecipeGpPct (hand-verified) ───────────────────────────────

describe("computeRecipeGpPct — recipe-level GP% formula", () => {
  // Hand-verify Negroni (used in Suites D and E):
  //   rrp=$20, oldCogs=$2.00 → GP% = round2(((20-2)/20)*100) = round2(90.0) = 90
  it("Negroni old: rrp=$20, cogs=$2.00 → 90.0%", () => {
    expect(computeRecipeGpPct(20, 2.00)).toBe(90);
  });

  //   rrp=$20, newCogs=$3.00 → GP% = round2(((20-3)/20)*100) = round2(85.0) = 85
  it("Negroni new: rrp=$20, cogs=$3.00 → 85.0%", () => {
    expect(computeRecipeGpPct(20, 3.00)).toBe(85);
  });

  // Hand-verify G&T (used in Suite E):
  //   rrp=$12, oldCogs=$1.00 → GP% = round2(((12-1.00)/12)*100) = round2(91.666…) = 91.67
  it("G&T old: rrp=$12, cogs=$1.00 → 91.67%", () => {
    expect(computeRecipeGpPct(12, 1.00)).toBe(91.67);
  });

  //   rrp=$12, newCogs=$1.50 → GP% = round2(((12-1.50)/12)*100) = round2(87.5) = 87.5
  it("G&T new: rrp=$12, cogs=$1.50 → 87.5%", () => {
    expect(computeRecipeGpPct(12, 1.50)).toBe(87.5);
  });

  // Hand-verify Coffee recipe (used in Suite C, below-threshold regression):
  //   rrp=$4.00, oldCogs=$0.50 → GP% = round2(((4-0.5)/4)*100) = round2(87.5) = 87.5
  it("Coffee old: rrp=$4.00, cogs=$0.50 → 87.5%", () => {
    expect(computeRecipeGpPct(4.00, 0.50)).toBe(87.5);
  });

  //   rrp=$4.00, newCogs=$0.55 → GP% = round2(((4-0.55)/4)*100) = round2(86.25) = 86.25
  it("Coffee new: rrp=$4.00, cogs=$0.55 → 86.25%", () => {
    expect(computeRecipeGpPct(4.00, 0.55)).toBe(86.25);
  });

  it("returns null when rrp is null", () => {
    expect(computeRecipeGpPct(null, 2.00)).toBeNull();
  });

  it("returns null when rrp is zero (avoids divide-by-zero)", () => {
    expect(computeRecipeGpPct(0, 2.00)).toBeNull();
  });

  it("returns null when rrp is negative", () => {
    expect(computeRecipeGpPct(-5, 2.00)).toBeNull();
  });

  it("100% GP when cogs is zero (gifted/free ingredients)", () => {
    expect(computeRecipeGpPct(15, 0)).toBe(100);
  });

  it("negative GP when cogs exceeds rrp (selling below cost)", () => {
    // round2(((5 - 8) / 5) * 100) = round2(-60) = -60
    expect(computeRecipeGpPct(5, 8)).toBe(-60);
  });
});

// ── Suite C: below threshold → no notice ─────────────────────────────────────

describe("buildGpAlertDocs — below threshold produces no notice (regression)", () => {
  // Coffee Beans price change: $10.00 → $11.00 (10% — clears the ≥5% trigger gate)
  //
  // Recipe "Flat White" uses 50g per serve from a 1000g bag:
  //   oldCostPerServe = (50/1000) * 10.00 = $0.50
  //   newCostPerServe = (50/1000) * 11.00 = $0.55
  //   deltaCogsPerServe = |$0.55 - $0.50| = $0.05
  //
  // Venue sensitivity: 'moderate' → threshold = $0.20
  //   $0.05 < $0.20 → no alert

  const coffeeImpact: RecipeImpact = {
    recipeId: "flat-white-1",
    recipeName: "Flat White",
    oldCogs: 0.50,
    newCogs: 0.55,
    oldGpPct: 87.5,  // hand-verified above: rrp=$4, cogs=$0.50
    newGpPct: 86.25, // hand-verified above: rrp=$4, cogs=$0.55
  };

  const INGREDIENT_ID = "coffee-beans-1";
  const INGREDIENT_NAME = "Coffee Beans 1kg";
  const THRESHOLD = gpAlertDollarThreshold("moderate")!; // $0.20

  it("$0.05 cogs delta is below the 'moderate' threshold ($0.20) → no alert", () => {
    const alerts = buildGpAlertDocs(
      [coffeeImpact],
      THRESHOLD,
      INGREDIENT_ID,
      INGREDIENT_NAME,
      10.00,
      11.00,
      10, // changePercent
    );
    expect(alerts).toHaveLength(0);
  });

  it("same change with sensitivity='small' ($0.05 threshold) fires — confirms threshold is respected, not hardcoded", () => {
    const smallThreshold = gpAlertDollarThreshold("small")!; // $0.05
    const alerts = buildGpAlertDocs(
      [coffeeImpact],
      smallThreshold,
      INGREDIENT_ID,
      INGREDIENT_NAME,
      10.00,
      11.00,
      10,
    );
    expect(alerts).toHaveLength(1); // $0.05 >= $0.05 — fires on 'small'
  });

  it("'off' sensitivity is already handled upstream (threshold=null), but a very high threshold also produces no alerts", () => {
    const alerts = buildGpAlertDocs(
      [coffeeImpact],
      Infinity, // simulates effectively-off threshold
      INGREDIENT_ID,
      INGREDIENT_NAME,
      10.00,
      11.00,
      10,
    );
    expect(alerts).toHaveLength(0);
  });

  it("empty recipe list → no alerts regardless of threshold", () => {
    const alerts = buildGpAlertDocs([], THRESHOLD, INGREDIENT_ID, INGREDIENT_NAME, 10, 11, 10);
    expect(alerts).toHaveLength(0);
  });
});

// ── Suite D: above threshold — correct attribution + hand-verified GP% ────────

describe("buildGpAlertDocs — above threshold, correct attribution + GP% values", () => {
  // Gin 700ml price change: $14.00 → $21.00 (50% — well above the ≥5% gate)
  //
  // Recipe "Negroni" uses 100ml per serve from a 700ml bottle:
  //   oldCostPerServe = (100/700) * 14.00 = 2.000 exactly
  //   newCostPerServe = (100/700) * 21.00 = 3.000 exactly
  //   deltaCogsPerServe = |$3.00 - $2.00| = $1.00
  //
  // Venue sensitivity: 'moderate' → threshold = $0.20
  //   $1.00 >= $0.20 → alert fires

  const negroniImpact: RecipeImpact = {
    recipeId: "negroni-1",
    recipeName: "Negroni",
    oldCogs: 2.00, // (100/700)*14 = 2.000 exactly
    newCogs: 3.00, // (100/700)*21 = 3.000 exactly
    oldGpPct: 90,  // hand-verified: round2(((20-2)/20)*100) = 90
    newGpPct: 85,  // hand-verified: round2(((20-3)/20)*100) = 85
  };

  const THRESHOLD = gpAlertDollarThreshold("moderate")!; // $0.20
  let alerts: ReturnType<typeof buildGpAlertDocs>;

  beforeEach(() => {
    alerts = buildGpAlertDocs(
      [negroniImpact],
      THRESHOLD,
      "gin-700ml-1",
      "Gin 700ml",
      14.00,
      21.00,
      50, // changePercent
    );
  });

  it("produces exactly one alert", () => {
    expect(alerts).toHaveLength(1);
  });

  it("alert carries correct recipe attribution", () => {
    expect(alerts[0].recipeId).toBe("negroni-1");
    expect(alerts[0].recipeName).toBe("Negroni");
  });

  it("alert carries correct ingredient attribution", () => {
    expect(alerts[0].ingredientProductId).toBe("gin-700ml-1");
    expect(alerts[0].ingredientProductName).toBe("Gin 700ml");
  });

  it("alert carries correct old/new cost price", () => {
    expect(alerts[0].oldCostPrice).toBe(14.00);
    expect(alerts[0].newCostPrice).toBe(21.00);
  });

  it("oldGpPct = 90 (hand-verified: round2(((20-2)/20)*100) = 90)", () => {
    expect(alerts[0].oldGpPct).toBe(90);
  });

  it("newGpPct = 85 (hand-verified: round2(((20-3)/20)*100) = 85)", () => {
    expect(alerts[0].newGpPct).toBe(85);
  });

  it("changePercent is stored on the alert", () => {
    expect(alerts[0].changePercent).toBe(50);
  });
});

// ── Suite E: multiple recipes — each gets its own notice ─────────────────────

describe("buildGpAlertDocs — multiple recipes each get their own correctly-attributed notice", () => {
  // Same Gin 700ml price change: $14.00 → $21.00 (50%)
  //
  // Two recipes use this ingredient:
  //
  // Recipe 1 "Negroni": 100ml per serve
  //   oldCogs = (100/700)*14 = 2.000; newCogs = (100/700)*21 = 3.000; delta = $1.00
  //   oldGpPct (rrp=$20) = round2(((20-2)/20)*100) = 90
  //   newGpPct (rrp=$20) = round2(((20-3)/20)*100) = 85
  //
  // Recipe 2 "G&T": 50ml per serve
  //   oldCogs = (50/700)*14 = 1.000 exactly; newCogs = (50/700)*21 = 1.500 exactly; delta = $0.50
  //   oldGpPct (rrp=$12) = round2(((12-1.00)/12)*100) = round2(91.666…) = 91.67
  //   newGpPct (rrp=$12) = round2(((12-1.50)/12)*100) = round2(87.5) = 87.5

  const negroniImpact: RecipeImpact = {
    recipeId: "negroni-1",
    recipeName: "Negroni",
    oldCogs: 2.00,
    newCogs: 3.00,
    oldGpPct: 90,
    newGpPct: 85,
  };

  const gtImpact: RecipeImpact = {
    recipeId: "gt-1",
    recipeName: "G&T",
    oldCogs: 1.00, // (50/700)*14 = 1.000 exactly
    newCogs: 1.50, // (50/700)*21 = 1.500 exactly
    oldGpPct: 91.67, // hand-verified: round2(((12-1.00)/12)*100) = 91.67
    newGpPct: 87.5,  // hand-verified: round2(((12-1.50)/12)*100) = 87.5
  };

  const THRESHOLD = gpAlertDollarThreshold("moderate")!; // $0.20
  let alerts: ReturnType<typeof buildGpAlertDocs>;

  beforeEach(() => {
    alerts = buildGpAlertDocs(
      [negroniImpact, gtImpact],
      THRESHOLD,
      "gin-700ml-1",
      "Gin 700ml",
      14.00,
      21.00,
      50,
    );
  });

  it("produces two alerts — one per recipe, not a conflated record", () => {
    expect(alerts).toHaveLength(2);
  });

  it("first alert is attributed to Negroni", () => {
    expect(alerts[0].recipeId).toBe("negroni-1");
    expect(alerts[0].recipeName).toBe("Negroni");
  });

  it("second alert is attributed to G&T", () => {
    expect(alerts[1].recipeId).toBe("gt-1");
    expect(alerts[1].recipeName).toBe("G&T");
  });

  it("Negroni alert: oldGpPct=90, newGpPct=85 (hand-verified)", () => {
    const negroni = alerts.find((a) => a.recipeId === "negroni-1")!;
    expect(negroni.oldGpPct).toBe(90);
    expect(negroni.newGpPct).toBe(85);
  });

  it("G&T alert: oldGpPct=91.67, newGpPct=87.5 (hand-verified)", () => {
    const gt = alerts.find((a) => a.recipeId === "gt-1")!;
    expect(gt.oldGpPct).toBe(91.67);
    expect(gt.newGpPct).toBe(87.5);
  });

  it("both alerts share the same ingredient attribution (the one ingredient that moved)", () => {
    for (const alert of alerts) {
      expect(alert.ingredientProductId).toBe("gin-700ml-1");
      expect(alert.ingredientProductName).toBe("Gin 700ml");
    }
  });

  it("alerts are independent records — each recipe has its own unique recipeId", () => {
    const recipeIds = alerts.map((a) => a.recipeId);
    const unique = new Set(recipeIds);
    expect(unique.size).toBe(alerts.length);
  });
});

// ── Suite F: dismissed fields on new alerts ───────────────────────────────────

describe("buildGpAlertDocs — new alerts are created in undismissed state", () => {
  const impact: RecipeImpact = {
    recipeId: "r1", recipeName: "Test Recipe",
    oldCogs: 1.00, newCogs: 2.00, oldGpPct: 80, newGpPct: 75,
  };

  it("dismissed is false on a new alert", () => {
    const [alert] = buildGpAlertDocs([impact], 0.20, "p1", "Product", 10, 20, 100);
    expect(alert.dismissed).toBe(false);
  });

  it("dismissedBy is null on a new alert", () => {
    const [alert] = buildGpAlertDocs([impact], 0.20, "p1", "Product", 10, 20, 100);
    expect(alert.dismissedBy).toBeNull();
  });

  it("dismissedAt is null on a new alert", () => {
    const [alert] = buildGpAlertDocs([impact], 0.20, "p1", "Product", 10, 20, 100);
    expect(alert.dismissedAt).toBeNull();
  });
});
