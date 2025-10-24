const { money, detectUnitAndSize, cleanName } = require('../utils.cjs');
module.exports = function extractNicelyDone({ text, supplier='Nicely Done' }) {
  const rows = [];
  const lines = (text||'').split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  for (const line of lines) {
    if (!/\$\s*\d/.test(line)) continue;
    const { size, unit } = detectUnitAndSize(line);
    const name = cleanName(line.replace(/\$\s*\d[\d,]*\.?\d*/g,''));
    const prices = [...line.matchAll(/\$\s*\d[\d,]*\.?\d*/g)].map(m=>m[0]);
    const priceBottleExGst = prices.length ? money(prices[0]) : null;
    const priceCaseExGst = prices.length>1 ? money(prices[prices.length-1]) : null;
    if (!name) continue;
    rows.push({
      supplier, externalSku:'', name, size, abv:'', unitsPerCase:'', unit: unit||'bottle',
      priceBottleExGst, priceCaseExGst, gstPercent:15, category:'', notes:''
    });
  }
  return rows;
};
