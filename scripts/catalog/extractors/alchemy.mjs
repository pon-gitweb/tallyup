import { detectUnitAndSize, cleanName, money } from '../utils.mjs';
export default function extractAlchemy({ text, supplier='Alchemy Tonic' }) {
  const rows = [];
  const lines = (text||'').split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  for (const line of lines) {
    if (!/160\s*ml|200\s*ml|250\s*ml|ml\b/i.test(line)) continue;
    const { size, unit } = detectUnitAndSize(line);
    if (!size) continue;
    const name = cleanName(line.replace(/\$\s*\d[\d,]*\.?\d*/g,''));
    const prices = [...line.matchAll(/\$\s*\d[\d,]*\.?\d*/g)].map(m=>m[0]);
    const priceBottleExGst = prices.length === 1 ? money(prices[0]) : null;
    const priceCaseExGst = prices.length > 1 ? money(prices[prices.length-1]) : null;
    const unitsPerCase = (() => {
      const m = line.match(/\b(\d{2})\s*(pack|case|ct|x)\b/i);
      if (m) return Number(m[1]);
      if (priceBottleExGst && priceCaseExGst) {
        const n = Math.round(priceCaseExGst / priceBottleExGst);
        return Number.isFinite(n) && n>1 ? n : '';
      }
      return '';
    })();
    rows.push({
      supplier, externalSku:'', name, size, abv:'', unitsPerCase, unit,
      priceBottleExGst, priceCaseExGst, gstPercent:15, category:'', notes:''
    });
  }
  // Dedup
  const seen = new Set();
  return rows.filter(r=>{
    const k = `${r.name}|${r.size}|${r.unitsPerCase}`;
    if (seen.has(k)) return false; seen.add(k); return true;
  });
}
