import { detectUnitAndSize, parseABV, cleanName, money } from '../utils.mjs';
export default function extractNo8({ text, supplier='No.8 Distillery' }) {
  const rows = [];
  const lines = (text||'').split(/\r?\n/).map(l=>l.trim());
  for (let i=0;i<lines.length;i++) {
    const line = lines[i];
    if (!/\b(ml|l|ltr|litre)s?\b/i.test(line)) continue;
    const window = [lines[i-1]||'', line, lines[i+1]||'', lines[i+2]||''].join(' ');
    const { size, unit } = detectUnitAndSize(window);
    if (!size) continue;
    const name = cleanName(line.replace(/\s{2,}/g,' '));
    const abvMatch = window.match(/(\d{1,2}(?:\.\d+)?)\s*%\s*ABV/i) || window.match(/(\d{1,2}(?:\.\d+)?)\s*%/);
    const abv = parseABV(abvMatch?.[1]);
    const priceBottleExGst = (() => {
      const m = window.match(/\$\s*\d[\d,]*\.?\d*/);
      return m ? money(m[0]) : null;
    })();
    rows.push({
      supplier, externalSku:'', name, size, abv, unitsPerCase:'', unit,
      priceBottleExGst, priceCaseExGst:'', gstPercent:15, category:'', notes:''
    });
  }
  const uniq = new Map();
  for (const r of rows) {
    if (!r.name || r.name.length<3) continue;
    const k = `${r.name}|${r.size}`;
    if (!uniq.has(k)) uniq.set(k, r);
  }
  return [...uniq.values()];
}
