const { money, detectUnitAndSize, parseABV, cleanName } = require('../utils.cjs');
module.exports = function extractPLC({ text, supplier='Premium Liquor' }) {
  const rows = [];
  const lines = (text||'').split(/\r?\n/).map(l=>l.trim()).filter(Boolean);

  const isHeading = l => /^page\s*\d+|^index$|^price|^category/i.test(l);
  const isPricey  = l => /\$\s*\d/.test(l);

  for (let i=0;i<lines.length;i++) {
    const line = lines[i];
    if (!/\b(\d+(?:\.\d+)?)(ml|l|ltr|litre|litres)\b/i.test(line)) continue;

    // Find a likely name line just above
    let nameLine = '';
    for (let j=i-1; j>=0 && j>=i-4; j--) {
      const L = lines[j];
      if (!L) continue;
      if (isHeading(L) || isPricey(L)) continue;
      if (/[A-Za-z]/.test(L)) { nameLine = L; break; }
    }
    const window = [lines[i-1]||'', line, lines[i+1]||''].join(' ');
    const { size, unit } = detectUnitAndSize(window);
    if (!size) continue;

    const name = cleanName(nameLine || line.replace(/\$\s*\d[\d,]*\.?\d*/g,''));
    if (!name || name.length < 3) continue;

    const abvMatch = window.match(/(\d{1,2}(?:\.\d+)?)\s*%\s*(?:ABV)?/i);
    const abv = parseABV(abvMatch?.[1]);
    const priceOne = window.match(/\$\s*\d[\d,]*\.?\d*/);
    const priceBottleExGst = priceOne ? money(priceOne[0]) : null;

    rows.push({
      supplier, externalSku:'', name, size, abv, unitsPerCase:'', unit,
      priceBottleExGst, priceCaseExGst:'', gstPercent:15, category:'', notes:''
    });
  }
  const uniq = new Map();
  for (const r of rows) { const k = `${r.name}|${r.size}`; if (!uniq.has(k)) uniq.set(k, r); }
  return [...uniq.values()];
};
