// @ts-nocheck
/**
 * Read-only CSV → normalized preview + match suggestions.
 * No Firestore access. Caller supplies existingProducts for suggestion matching.
 */

export type HeaderMap = {
  name?: string;       // CSV header text for product name
  sku?: string;        // CSV header text for supplier SKU
  price?: string;      // CSV header text for price (accepts $ and commas)
  packSize?: string;   // CSV header text for pack size string (e.g., "6x750ml")
  unit?: string;       // CSV header text for unit (e.g., "bottle", "kg")
  gstPercent?: string; // CSV header text for GST/VAT percent
};

export type CanonicalSupplierRow = {
  name: string;
  sku?: string | null;
  price?: number | null;
  packSize?: string | null;
  unit?: string | null;
  gstPercent?: number | null;
  raw: Record<string, string>; // original row key/value
};

export type ProductCandidate = { id: string; name?: string | null };
export type PreviewSuggestion = {
  rowIndex: number;
  productId?: string | null;
  productName?: string | null;
  matchQuality: 'exact' | 'startsWith' | 'none';
  candidates: Array<{ productId: string; name?: string | null }>;
};

export function previewCatalog(params: {
  csvText: string;
  headerMap: HeaderMap;
  existingProducts: ProductCandidate[];
  maxCandidates?: number;
}): { rows: CanonicalSupplierRow[]; suggestions: PreviewSuggestion[] } {
  const { csvText, headerMap, existingProducts, maxCandidates = 5 } = params || {};
  if (!csvText || typeof csvText !== 'string') return { rows: [], suggestions: [] };

  const matrix = parseCSV(csvText);
  if (!matrix.length) return { rows: [], suggestions: [] };

  // Header row
  const headers = matrix[0].map((h) => (h || '').trim());
  const getIdx = (hdr?: string) => {
    if (!hdr) return -1;
    const i = headers.findIndex((h) => eq(h, hdr));
    return i >= 0 ? i : -1;
  };

  const idx = {
    name: getIdx(headerMap.name),
    sku: getIdx(headerMap.sku),
    price: getIdx(headerMap.price),
    packSize: getIdx(headerMap.packSize),
    unit: getIdx(headerMap.unit),
    gstPercent: getIdx(headerMap.gstPercent),
  };

  const rows: CanonicalSupplierRow[] = [];
  const suggestions: PreviewSuggestion[] = [];
  const productsByLowerName = buildNameIndex(existingProducts || []);

  for (let r = 1; r < matrix.length; r++) {
    const row = matrix[r];
    if (!row || row.length === 0) continue;

    const rawObj: Record<string, string> = {};
    headers.forEach((h, i) => (rawObj[h] = (row[i] ?? '').trim()));

    const name = pickStr(row, idx.name);
    if (!name) continue; // require name for MVP

    const norm: CanonicalSupplierRow = {
      name,
      sku: pickStr(row, idx.sku),
      price: toNumber(pickStr(row, idx.price)),
      packSize: pickStr(row, idx.packSize),
      unit: pickStr(row, idx.unit),
      gstPercent: toNumber(pickStr(row, idx.gstPercent)),
      raw: rawObj,
    };
    rows.push(norm);

    // Suggestions
    const lower = name.toLowerCase();
    let matchQuality: 'exact' | 'startsWith' | 'none' = 'none';
    let productId: string | null = null;
    let productName: string | null = null;

    // exact
    const exact = productsByLowerName.get(lower);
    if (exact) {
      matchQuality = 'exact';
      productId = exact.id;
      productName = exact.name ?? null;
    } else {
      // startsWith: collect
      const cands = (existingProducts || []).filter((p) =>
        (p?.name || '').toLowerCase().startsWith(lower)
      );
      if (cands.length) {
        matchQuality = 'startsWith';
        // top candidate is first
        productId = cands[0].id || null;
        productName = cands[0].name ?? null;
      }
    }

    const candidates = buildCandidates(existingProducts || [], lower, maxCandidates);
    suggestions.push({
      rowIndex: rows.length - 1,
      productId,
      productName,
      matchQuality,
      candidates,
    });
  }

  return { rows, suggestions };
}

/** ------ helpers ------ */

function eq(a?: string, b?: string) {
  return (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase();
}

function pickStr(row: string[], i: number) {
  if (i < 0 || i >= row.length) return null;
  const v = (row[i] ?? '').trim();
  return v.length ? v : null;
}

function toNumber(s?: string | null) {
  if (!s) return null;
  const clean = s.replace(/[,$\s]/g, '');
  const n = Number.parseFloat(clean);
  return Number.isFinite(n) ? n : null;
}

function buildNameIndex(products: ProductCandidate[]) {
  const map = new Map<string, ProductCandidate>();
  for (const p of products) {
    const k = (p?.name || '').toLowerCase();
    if (k) map.set(k, p);
  }
  return map;
}

function buildCandidates(products: ProductCandidate[], lowerNeedle: string, max: number) {
  const list: Array<{ productId: string; name?: string | null }> = [];
  for (const p of products) {
    const n = (p?.name || '').toLowerCase();
    if (!n) continue;
    if (n === lowerNeedle || n.startsWith(lowerNeedle)) {
      list.push({ productId: p.id, name: p.name ?? null });
    }
    if (list.length >= max) break;
  }
  return list;
}

/**
 * Minimal CSV parser: supports quoted fields, commas, double-quotes escaping ("").
 * Splits on CRLF/CR/LF line breaks.
 */
export function parseCSV(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let inQ = false;

  const pushCell = () => { row.push(cur); cur = ''; };
  const pushRow = () => { out.push(row); row = []; };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const nxt = text[i + 1];

    if (inQ) {
      if (ch === '"' && nxt === '"') { cur += '"'; i++; continue; }
      if (ch === '"') { inQ = false; continue; }
      cur += ch;
      continue;
    }

    if (ch === '"') { inQ = true; continue; }
    if (ch === ',') { pushCell(); continue; }
    if (ch === '\n') { pushCell(); pushRow(); continue; }
    if (ch === '\r') {
      if (nxt === '\n') { /* CRLF */ }
      pushCell(); pushRow();
      if (nxt === '\n') i++;
      continue;
    }
    cur += ch;
  }
  // trailing cell/row
  pushCell();
  if (row.length > 1 || (row.length === 1 && row[0].length)) pushRow();

  return out;
}
