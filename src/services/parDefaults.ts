// @ts-nocheck
/**
 * parDefaults.ts
 * Intelligent PAR level inference based on product name and unit.
 * Built on real hospitality logic — fridge facings, bottle sizes,
 * reorder frequency, and typical venue usage patterns.
 */

export function inferDefaultPAR(name: string, unit?: string | null): number {
  const n = (name || '').toLowerCase();
  const u = (unit || '').toLowerCase();

  // ── Kegs ──────────────────────────────────────────────────────────────────
  if (n.includes('keg') || u.includes('keg') || u.includes('50l') || u.includes('30l')) return 2;

  // ── Spirits — 700ml/750ml/1L bottles ─────────────────────────────────────
  if (u.includes('700') || u.includes('750') || u.includes('1l') || u.includes('litre') || u.includes('liter')) {
    // High volume well/house spirits
    if (n.includes('house') || n.includes('well') || n.includes('rail')) return 3;
    // Standard spirits
    return 2;
  }

  // ── Beer — bottles and cans ───────────────────────────────────────────────
  // 330ml — standard stubby/bottle row = 6-8, default 2 rows
  if (u.includes('330') || (n.includes('beer') && u.includes('ml') && !u.includes('500'))) return 12;
  // 500ml pints
  if (u.includes('500') || u.includes('pint')) return 6;
  // Generic beer without unit
  if (n.includes('lager') || n.includes('ale') || n.includes('ipa') ||
      n.includes('stout') || n.includes('pilsner') || n.includes('pale ale')) return 12;

  // ── Wine ──────────────────────────────────────────────────────────────────
  if (n.includes('sauvignon') || n.includes('chardonnay') || n.includes('pinot') ||
      n.includes('merlot') || n.includes('shiraz') || n.includes('riesling') ||
      n.includes('rosé') || n.includes('rose') || n.includes('malbec')) {
    if (n.includes('house') || n.includes('carafe')) return 12;
    return 6;
  }
  if (n.includes('wine')) return 6;

  // ── Sparkling/Champagne ───────────────────────────────────────────────────
  if (n.includes('champagne') || n.includes('sparkling') || n.includes('prosecco') ||
      n.includes('cava') || n.includes('cremant')) return 4;

  // ── Liqueurs ──────────────────────────────────────────────────────────────
  if (n.includes('kahlua') || n.includes('baileys') || n.includes('cointreau') ||
      n.includes('triple sec') || n.includes('amaretto') || n.includes('schnapps') ||
      n.includes('liqueur') || n.includes('liquor')) return 2;

  // ── Mixers and non-alcoholic ──────────────────────────────────────────────
  if (n.includes('tonic') || n.includes('soda water') || n.includes('cola') ||
      n.includes('ginger beer') || n.includes('ginger ale') || n.includes('lemonade') ||
      n.includes('juice') || n.includes('energy drink') || n.includes('redbull')) return 24;

  // ── Syrups, bitters, cordials ─────────────────────────────────────────────
  if (n.includes('syrup') || n.includes('cordial') || n.includes('bitters') ||
      n.includes('grenadine') || n.includes('falernum')) return 2;

  // ── Garnishes ─────────────────────────────────────────────────────────────
  if (n.includes('lime') || n.includes('lemon') || n.includes('orange') ||
      n.includes('olive') || n.includes('cherry') || n.includes('mint') ||
      n.includes('garnish')) return 3;

  // ── Cleaning/consumables ──────────────────────────────────────────────────
  if (n.includes('clean') || n.includes('sanitiser') || n.includes('sanitizer') ||
      n.includes('detergent') || n.includes('glass cloth') || n.includes('napkin') ||
      n.includes('straw') || n.includes('toothpick')) return 2;

  // ── Food items — too variable, set low ───────────────────────────────────
  if (n.includes('chicken') || n.includes('beef') || n.includes('fish') ||
      n.includes('pork') || n.includes('lamb') || n.includes('potato') ||
      n.includes('flour') || n.includes('oil') || n.includes('sauce')) return 2;

  // ── Default fallback ──────────────────────────────────────────────────────
  return 2;
}

export function getPARDescription(par: number, name: string, unit?: string | null): string {
  const n = (name || '').toLowerCase();
  if (par === 2) return 'Minimum stock — reorder when below this';
  if (par === 3) return 'High usage item — keep 3 in stock';
  if (par === 6) return 'One half-case minimum';
  if (par === 12) return 'One dozen — typical fridge facing';
  if (par === 24) return 'One case minimum';
  return `Suggested minimum: ${par} ${unit || 'units'}`;
}
