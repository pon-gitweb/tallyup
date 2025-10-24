const { detectUnitAndSize, cleanName, parseABV, money } = require('../utils.cjs');
module.exports = function extractMasterFMC({ text, supplier='MASTER FM&Co' }) {
  const rows = [];
  const lines = (text||'').split(/\r?\n/).map(l=>l.trim());
  for (let i=0;i<lines.length;i++) {
    const line = lines[i];
    if (!/\b(ml|l|ltr|litre)s?\b/i.test(line)) continue;
    const window = [lines[i-1]||'', line, lines[i+1]||''].join(' ');
    const { size, unit } = detectUnitAndSize(window);
    if (!size) continue;
    const name = cleanName(line);
    const abvMatch = window.match(/(\d{1,2}(?:\.\d+)?)\s*%\s*ABV/i) || window.match(/(\d{1,2}(?:\.\d+)?)\s*%/);
    const abv = parseABV(abvMatch?.[1]);
    const price = window.match(/\$\s*\d[\d,]*\.?\d*/);
    rows.push({
      supplier, externalSku:'', name, size, abv, unitsPerCase:'', unit,
      priceBottleExGst: price ? money(price[0]) : null, priceCaseExGst:'', gstPercent:15, category:'', notes:''
    });
  }
  const uniq = new Map();
  for (const r of rows) {
    if (!r.name || r.name.length<3) continue;
    const k = `${r.name}|${r.size}`;
    if (!uniq.has(k)) uniq.set(k, r);
  }
  return [...uniq.values()];
};
