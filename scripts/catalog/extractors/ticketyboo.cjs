const { money, detectUnitAndSize, parseABV, cleanName } = require('../utils.cjs');
module.exports = function extractTicketyBoo({ text, supplier='Tickety Boo' }) {
  const rows = [];
  const lines = (text||'').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  for (const line of lines) {
    const hasDollar = /\$\s*\d/.test(line);
    const abvMatch = line.match(/\b(\d{1,2}(?:\.\d+)?)\b/);
    if (!hasDollar || !abvMatch) continue;
    const priceMatches = [...line.matchAll(/\$\s*\d[\d,]*\.?\d*/g)].map(m=>m[0]);
    if (!priceMatches.length) continue;
    const unitsMatch = line.match(/\b(\d{1,3})\b(?!.*\b\d{1,3}\b.*\$)/);
    const unitsPerCase = unitsMatch ? Number(unitsMatch[1]) : null;
    const abv = parseABV(abvMatch?.[1]);
    let namePart = line.replace(/\$\s*\d[\d,]*\.?\d*/g,'')
      .replace(/\b\d{1,3}(\.\d+)?\b/g, '')
      .replace(/\bml\b|\bl\b/ig, (m)=>` ${m.toLowerCase()} `)
      .replace(/\s{2,}/g,' ').trim();
    const { size, unit } = detectUnitAndSize(line);
    const name = cleanName(namePart);
    const priceBottleExGst = money(priceMatches[0]);
    const priceCaseExGst = priceMatches.length > 1 ? money(priceMatches[priceMatches.length-1]) : null;
    rows.push({
      supplier, externalSku:'', name, size, abv,
      unitsPerCase: unitsPerCase || (priceCaseExGst && priceBottleExGst ? Math.round(priceCaseExGst/priceBottleExGst) : ''),
      unit, priceBottleExGst, priceCaseExGst, gstPercent:15, category:'', notes:''
    });
  }
  const seen = new Set();
  return rows.filter(r=>{
    const key = `${r.name}|${r.size}|${r.abv}|${r.unitsPerCase}`;
    if (seen.has(key)) return false; seen.add(key);
    return r.name && (r.priceBottleExGst || r.priceCaseExGst);
  });
};
