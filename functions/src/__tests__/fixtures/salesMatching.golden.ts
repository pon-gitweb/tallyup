/**
 * Golden fixture for sales-line matching.
 *
 * Products are ordered intentionally: "Tanqueray No Ten" before "Tanqueray" to
 * expose the old find()-first bug.  The new algorithm resolves ambiguity via
 * exact normalisation so array order no longer matters.
 *
 * "Red Door" and "Batch Red Door" both exist: the exact match (Step 3) wins,
 * so "Red Door" → "Red Door", not "Batch Red Door".  Modifier step (Step 4)
 * handles lines where only the Batch product exists (Salsa Verde, Mapo District…).
 *
 * POS line names reflect real-world noise: trailing "(Well)"/"(well)" suffixes,
 * accented characters, commas between region and country ("Languedoc, France"),
 * and terse bar names without the "Batch" prefix.
 */

export interface Product {
  id: string;
  name: string;
  barcode?: string;
  sku?: string;
}

export interface SalesLine {
  name: string;
  qtySold: number;
  barcode?: string;
  sku?: string;
}

export interface GoldenCase {
  line: SalesLine;
  /** Product name expected, or null for "should be unknown". */
  expectedProductName: string | null;
  note?: string;
}

// ── Stock products ────────────────────────────────────────────────────────────
// Ordering is deliberate: No Ten before Tanqueray to show the find()-first bug.

export const PRODUCTS: Product[] = [
  { id: 'p-guinness-0',      name: 'Guinness 0%' },
  { id: 'p-tanqueray-noten', name: 'Tanqueray No Ten' },   // must precede Tanqueray
  { id: 'p-tanqueray',       name: 'Tanqueray' },
  { id: 'p-og-apple-juice',  name: 'Orchard Grove Apple Juice' }, // juice products early
  { id: 'p-plum-juice',      name: 'Plum Juice' },
  { id: 'p-oj-sqzd',         name: 'Orange Juice Squezed' },
  { id: 'p-lemon-juice',     name: 'Lemon Juice Fresh Squeezed' },
  { id: 'p-mccoy-oj',        name: 'McCoy Orange Juice' },
  { id: 'p-mccoy-pj',        name: 'McCoy Pineapple Juice' },
  { id: 'p-mccoy-cj',        name: 'McCoy Cranberry Juice' },
  { id: 'p-cherry-plum-j',   name: 'Cherry & Plum Juice' },
  { id: 'p-acid-lime-j',     name: 'Acid Adjusted Lime Juice' },
  { id: 'p-plum-juice-700',  name: 'Plum Juice 700ml' },
  { id: 'p-ron-pat',         name: 'Ron Paticruzado Los Marinos Viejo 1L (40%)' },
  { id: 'p-kirin-beer',      name: 'Kirin Beer' },
  { id: 'p-kirin-keg',       name: 'Kirin Keg 50 L' },
  { id: 'p-guinness-keg',    name: 'Guinness Keg 50litre' },
  { id: 'p-guinness-sami',   name: 'Guinness Sami (Small)' },
  { id: 'p-guinness',        name: 'Guinness' },
  // Languedoc product before Co Pinard — correct match for the comma-separated line
  { id: 'p-picpoul-lang',    name: 'Petite Ronde Picpoul de Pinet 2024 Languedoc France' },
  { id: 'p-picpoul-co',      name: 'Petite Ronde Picpoul Co Pinard' },
  // Bierzo Spain before 750ml — correct match for the accented+comma line
  { id: 'p-mencia-bierzo',   name: 'Matilda Nieves Mencia 2024 Bierzo Spain' },
  { id: 'p-mencia-750',      name: 'Matilda Nieves Mencía 2024 Matilda Nieves 750ml' },
  { id: 'p-patria',          name: 'Patria Chica Vino de Pago 2023 Vino de Pago Spain' },
  { id: 'p-leslys',          name: 'Les Lys Vouvray Sec 2023 Loire Valley France' },
  { id: 'p-batch-martini',   name: 'Batch Brine Dirty Martini' },
  { id: 'p-batch-gin-fizz',  name: 'Batch Gin Fizz Syrup' },
  { id: 'p-batch-salsa',     name: 'Batch Salsa Verde' },
  { id: 'p-andre',           name: 'Andre Clouet' },
  { id: 'p-oct30',           name: 'October 30 Gruner Veltliner' },
  { id: 'p-bel-espirit',     name: 'Bel Espirit Rose' },
  { id: 'p-amoise',          name: 'Amoise Syrah 2023' },
  { id: 'p-smirnoff',        name: 'Smirnoff in Well' },
  { id: 'p-duppy',           name: 'Duppy Share Spiced' },
  { id: 'p-jb',              name: 'J & B Rare' },
  { id: 'p-jose',            name: 'Jose Cuervo Tradicional Reposado' },
  { id: 'p-verde',           name: 'Verde Amars Mezcal' },
  { id: 'p-applejack',       name: 'Apple Jack' },
  { id: 'p-nodo',            name: 'NODO Blanco' },
  { id: 'p-lobo',            name: 'Lobo Sierra Raicilla' },
  { id: 'p-malbien',         name: 'Mal Bien Coyote' },
  { id: 'p-speights',        name: 'Speights Ultra' },
  { id: 'p-valrance',        name: 'Val de Rance Cidre Brut' },
  { id: 'p-reddoor',         name: 'Red Door' },          // both exist; exact match wins
  { id: 'p-batch-reddoor',   name: 'Batch Red Door' },
  { id: 'p-batch-mapo',      name: 'Batch Mapo District' },
  { id: 'p-batch-cafe',      name: 'Batch cafe Blanc' },
  { id: 'p-batch-low',       name: 'Batch Low Chance' },
];

// ── Golden cases ──────────────────────────────────────────────────────────────

export const GOLDEN_CASES: GoldenCase[] = [
  // ── Terse bar/batch names (product name longer than POS line) ──────────────
  { line: { name: 'Salsa Verde',    qtySold: 1 }, expectedProductName: 'Batch Salsa Verde' },
  { line: { name: 'Red Door',       qtySold: 1 }, expectedProductName: 'Red Door', note: 'exact match wins; "Batch Red Door" also exists but is not reached' },
  { line: { name: 'Mapo district',  qtySold: 1 }, expectedProductName: 'Batch Mapo District' },
  { line: { name: 'Cafe Blanc',     qtySold: 1 }, expectedProductName: 'Batch cafe Blanc' },
  { line: { name: 'Low Chance',     qtySold: 1 }, expectedProductName: 'Batch Low Chance' },

  // ── Case-only or accent-only mismatch ─────────────────────────────────────
  { line: { name: 'Andre clouet',         qtySold: 1 }, expectedProductName: 'Andre Clouet' },
  { line: { name: 'Bel Espirit rose',     qtySold: 1 }, expectedProductName: 'Bel Espirit Rose' },
  { line: { name: 'Lobo sierra Raicilla', qtySold: 1 }, expectedProductName: 'Lobo Sierra Raicilla' },

  // ── Exact or near-exact matches ───────────────────────────────────────────
  { line: { name: 'October 30 Gruner Veltliner',      qtySold: 1 }, expectedProductName: 'October 30 Gruner Veltliner' },
  { line: { name: 'Amoise Syrah 2023',                qtySold: 1 }, expectedProductName: 'Amoise Syrah 2023' },
  { line: { name: 'Smirnoff in well',                 qtySold: 1 }, expectedProductName: 'Smirnoff in Well' },
  { line: { name: 'Duppy Share Spiced',               qtySold: 1 }, expectedProductName: 'Duppy Share Spiced' },
  { line: { name: 'Verde Amars Mezcal',               qtySold: 1 }, expectedProductName: 'Verde Amars Mezcal' },
  { line: { name: 'Apple Jack',                       qtySold: 1 }, expectedProductName: 'Apple Jack' },
  { line: { name: 'NODO Blanco',                      qtySold: 1 }, expectedProductName: 'NODO Blanco' },
  { line: { name: 'Mal Bien Coyote',                  qtySold: 1 }, expectedProductName: 'Mal Bien Coyote' },
  { line: { name: 'Kirin beer',                       qtySold: 1 }, expectedProductName: 'Kirin Beer' },
  { line: { name: 'Speights Ultra',                   qtySold: 1 }, expectedProductName: 'Speights Ultra' },
  { line: { name: 'Val de Rance Cidre Brut',          qtySold: 1 }, expectedProductName: 'Val de Rance Cidre Brut' },
  { line: { name: 'Jose Cuervo Tradicional Reposado', qtySold: 1 }, expectedProductName: 'Jose Cuervo Tradicional Reposado' },

  // ── POS "(Well)" suffix noise ─────────────────────────────────────────────
  { line: { name: 'J & B Rare (Well)',                          qtySold: 1 }, expectedProductName: 'J & B Rare' },
  { line: { name: 'Jose Cuervo Tradicional Reposado (Well)',    qtySold: 1 }, expectedProductName: 'Jose Cuervo Tradicional Reposado' },
  { line: { name: 'Kirin beer small',                           qtySold: 1 }, expectedProductName: 'Kirin Beer' },

  // ── Ambiguous: Tanqueray vs Tanqueray No Ten (products ordered No Ten first) ─
  {
    line: { name: 'Tanqueray', qtySold: 1 },
    expectedProductName: 'Tanqueray',
    note: 'must prefer exact name over longer "Tanqueray No Ten"',
  },

  // ── NEW: wine lines with trailing ", Country" comma ───────────────────────
  // The POS system appends ", France" / ", Spain" with a comma; product names
  // have a space.  The current substring algorithm fails all four.
  {
    line: { name: 'Petite Ronde Picpoul de Pinet 2024 Languedoc, France', qtySold: 1 },
    expectedProductName: 'Petite Ronde Picpoul de Pinet 2024 Languedoc France',
    note: 'comma in POS line; product has space — substring match fails',
  },
  {
    line: { name: 'Matilda Nieves Mencía 2024 Bierzo, Spain', qtySold: 1 },
    expectedProductName: 'Matilda Nieves Mencia 2024 Bierzo Spain',
    note: 'accent on Mencía in POS line; product stored without accent — substring match fails',
  },
  {
    line: { name: 'Patria Chica Vino de Pago 2023 Vino de Pago, Spain', qtySold: 1 },
    expectedProductName: 'Patria Chica Vino de Pago 2023 Vino de Pago Spain',
    note: 'comma in POS line',
  },
  {
    line: { name: 'Les Lys Vouvray Sec 2023 Loire Valley, France', qtySold: 1 },
    expectedProductName: 'Les Lys Vouvray Sec 2023 Loire Valley France',
    note: 'comma in POS line',
  },

  // ── Expected unknowns ─────────────────────────────────────────────────────
  { line: { name: 'Martini',                qtySold: 1 }, expectedProductName: null, note: 'generic — must not match Batch Brine Dirty Martini' },
  { line: { name: 'Juice',                  qtySold: 1 }, expectedProductName: null, note: 'generic — must not match any juice product' },
  { line: { name: 'Guiness',               qtySold: 1 }, expectedProductName: null, note: 'misspelling — no substring match' },
  { line: { name: 'Guiness samll',          qtySold: 1 }, expectedProductName: null, note: 'double misspelling' },
  { line: { name: 'Ron Paticruzado well dark', qtySold: 1 }, expectedProductName: null },
  { line: { name: 'Soft Drinks',            qtySold: 1 }, expectedProductName: null },
  { line: { name: 'Classics',              qtySold: 1 }, expectedProductName: null },
  { line: { name: 'Open Bev',              qtySold: 1 }, expectedProductName: null },
  { line: { name: 'Agave Friends',          qtySold: 1 }, expectedProductName: null },
  { line: { name: 'Pandan Splice',          qtySold: 1 }, expectedProductName: null },
  { line: { name: 'Tommy',                  qtySold: 1 }, expectedProductName: null },
  { line: { name: 'Garibaldi',              qtySold: 1 }, expectedProductName: null },
  { line: { name: 'Kallimotxo',             qtySold: 1 }, expectedProductName: null },
  { line: { name: 'Tropical Alb',           qtySold: 1 }, expectedProductName: null },
  { line: { name: 'Plancha Beef Tacos (1pc)', qtySold: 1 }, expectedProductName: null },
  { line: { name: 'Guacamole',              qtySold: 1 }, expectedProductName: null },
  { line: { name: 'Chipotle Esquites',      qtySold: 1 }, expectedProductName: null },

  // ── Overlap false-positives that must stay UNKNOWN ────────────────────────
  // The old overlap algorithm scored these 1.0 and "reliable".
  // The modifier step requires remaining token SETS to be equal; these all have
  // extra content words ("brine", "acid adjusted", "syrup") that survive stripping.
  { line: { name: 'Dirty Martini',  qtySold: 1 }, expectedProductName: null, note: '"Batch Brine Dirty Martini" strips to ["brine","dirty","martini"] ≠ ["dirty","martini"]' },
  { line: { name: 'Lime Juice',     qtySold: 1 }, expectedProductName: null, note: '"Acid Adjusted Lime Juice" strips to ["acid","adjusted","lime","juice"] ≠ ["lime","juice"]' },
  { line: { name: 'Gin Fizz',       qtySold: 1 }, expectedProductName: null, note: '"Batch Gin Fizz Syrup" strips to ["gin","fizz","syrup"] ≠ ["gin","fizz"]' },
  { line: { name: 'Orange Juice',   qtySold: 1 }, expectedProductName: null, note: '"mccoy" and "squezed" are content words not modifiers; neither product matches' },
];
