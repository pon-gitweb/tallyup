import { getApp } from 'firebase/app';
import {
  getFirestore, collection, getDocs, addDoc, serverTimestamp
} from 'firebase/firestore';
import type { NormalizedSalesReport } from './types';

/**
 * Matches report lines to products using:
 * 1) barcode exact
 * 2) sku exact
 * 3) name contains (lowercased)
 *
 * Writes:
 * - venues/{v}/salesReportMatches  (summary + matches[])
 * - venues/{v}/salesReportUnknowns (one doc per unknown line)
 */
export async function matchSalesToProducts(args: {
  venueId: string;
  reportId: string;
  report: NormalizedSalesReport;
}) {
  const { venueId, reportId, report } = args;
  const db = getFirestore(getApp());

  // Load products
  const products = await getDocs(collection(db, 'venues', venueId, 'products'));
  const byBarcode = new Map<string, any>();
  const bySku = new Map<string, any>();
  const list:any[] = [];
  products.forEach(d => {
    const p:any = { id: d.id, ...d.data() };
    const bc = (p.barcode || p.barCode || p.bar_code || '').toString().trim();
    const sku = (p.sku || p.code || '').toString().trim();
    if (bc) byBarcode.set(bc, p);
    if (sku) bySku.set(sku, p);
    list.push(p);
  });

  const matches:any[] = [];
  const unknowns:any[] = [];

  for (const ln of report?.lines || []) {
    const b = (ln.barcode || '').toString().trim();
    const s = (ln.sku || '').toString().trim();
    const n = (ln.name || '').toString().trim().toLowerCase();

    let hit:any = null;
    if (!hit && b && byBarcode.has(b)) hit = byBarcode.get(b);
    if (!hit && s && bySku.has(s)) hit = bySku.get(s);
    if (!hit && n) hit = list.find(p => (p.name || '').toString().toLowerCase().includes(n));

    if (hit) {
      matches.push({
        productId: hit.id,
        productName: hit.name || null,
        sku: s || null,
        barcode: b || null,
        name: ln.name || null,
        qtySold: Number(ln.qtySold || 0),
        gross: ln.gross ?? null,
        net: ln.net ?? null,
        tax: ln.tax ?? null,
      });
    } else {
      unknowns.push({ line: ln });
    }
  }

  // Summary write
  await addDoc(collection(db, 'venues', venueId, 'salesReportMatches'), {
    reportId,
    counts: { total: report?.lines?.length || 0, matched: matches.length, unknowns: unknowns.length },
    matches,
    period: report?.period || {},
    createdAt: serverTimestamp(),
  });

  // Unknowns write
  for (const u of unknowns) {
    await addDoc(collection(db, 'venues', venueId, 'salesReportUnknowns'), {
      reportId,
      line: u.line,
      status: 'unmapped',
      createdAt: serverTimestamp(),
    });
  }

  return { ok:true, matched: matches.length, unknowns: unknowns.length };
}
