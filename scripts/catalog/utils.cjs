exports.money = (s) => {
  if (s == null) return null;
  const t = String(s).replace(/[,\s]/g,'').replace(/\$/g,'').replace(/NZD/i,'');
  const num = parseFloat(t);
  return Number.isFinite(num) ? Number(num.toFixed(2)) : null;
};
exports.detectUnitAndSize = (nameOrSize) => {
  const s = (nameOrSize||'').toLowerCase();
  const sizeMatch = s.match(/\b(\d+(?:\.\d+)?)(ml|l|ltr|litre|litres)\b/);
  let unit = 'bottle';
  if (s.includes('rtd')) unit = 'rtd';
  if (s.includes('keg')) unit = 'keg';
  if (s.includes('bib') || s.includes('bag in box')) unit = 'bib';
  return { size: sizeMatch ? `${sizeMatch[1]}${sizeMatch[2].replace('ltr','l')}` : null, unit };
};
exports.parseABV = (s) => {
  if (!s) return null;
  const m = String(s).match(/(\d+(?:\.\d+)?)\s*%?/);
  return m ? Number(m[1]) : null;
};
exports.cleanName = (s) => (s||'').replace(/\s+/g,' ').trim();
exports.csvHeaders = [
  'supplier','externalSku','name','size','abv','unitsPerCase','unit',
  'priceBottleExGst','priceCaseExGst','gstPercent','category','notes'
];
exports.toRow = (obj) => exports.csvHeaders.map(h => obj[h] ?? '').join(',');
exports.ensureSupplierSlug = (t) =>
  String(t||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');
