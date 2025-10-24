const { detectUnitAndSize, parseABV, cleanName, money } = require('../utils.cjs');
module.exports = function extractNo8({ text, supplier='No.8 Distillery' }) {
  const rows = [];
  const lines = (text||'').split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  for (let i=0;i<lines.length;i++) {
    const line = lines[i];
    if (!/\b(ml|l|ltr|litre|litres)\b/i.test(line)) continue;
    const window = [lines[i-1]||'', line, lines[i+1]||'', lines[i+2]||''].join(' ');
    const { size, unit } = detectUnitAndSize(window);
    if (!size) continue;
    if (/^page\s*\d+|price|index|category/i.test(line)) continue;

    const name = cleanName(line.replace(/\$\s*\d[\d,]*\.?\d*/g,''));
    if (!name || name.length<3) continue;

    const abvMatch = window.match(/(\d{1,2}(?:\.\d+)?)\s*%\s*(?:ABV)?/i);
    const price = window.match(/\$\s*\d[\d,]*\.?\d*/);
    rows.push({
      supplier, externalSku:'', name, size,
      abv: abvMatch ? Number(abvMatch[1]) : null,
      unitsPerCase:'', unit,
      priceBottleExGst: price ? money(price[0]) : null,
      priceCaseExGst:'', gstPercent:15, category:'', notes:''
    });
  }
  const uniq = new Map();
  for (const r of rows) {
    const k = `${r.name}|${r.size}`;
    if (!uniq.has(k)) uniq.set(k, r);
  }
  return [...uniq.values()];
};
