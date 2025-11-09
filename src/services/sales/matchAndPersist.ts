// @ts-nocheck
import { getApp } from 'firebase/app';
import {
  getFirestore, collection, getDocs, addDoc, serverTimestamp
} from 'firebase/firestore';
import type { NormalizedSalesReport } from './types';

/**
 * Match sales lines to products by:
 * 1) barcode -> exact product.barcode
 * 2) sku -> product.sku
 * 3) fallback: name (lowercased contains) — conservative
 *
 * Writes:
 * - venues/{v}/salesReportMatches
 * - venues/{v}/salesReportUnknowns
 */
export async function matchAndPersistSalesReport(args: {
  venueId: string;
  reportId: string;
  report: NormalizedSalesReport;
}) {
  const { venueId, reportId, report } = args;
  const db = getFirestore(getApp());

  // Load products into simple indexes (keep it small & safe for MVP)
  const prodSnap = await getDocs(collection(db, 'venues', venueId, 'products'));
  const byBarcode = new Map<string, any>();
  const bySku = new Map<string, any>();
  const list:any[] = [];

  prodSnap.forEach(d => {
    const p:any = { id: d.id, ...d.data() };
    const bc = (p.barcode || p.barCode || p.bar_code || '').toString().trim();
    const sku = (p.sku || p.code || '').toString().trim();
    if (bc) byBarcode.set(bc, p);
    if (sku) bySku.set(sku, p);
    list.push(p);
  });

  const matches:any[] = [];
  const unknowns:any[] = [];

  for (const ln of report.lines || []) {
    const b = (ln.barcode || '').toString().trim();
    const s = (ln.sku || '').toString().trim();
    const n = (ln.name || '').toString().trim().toLowerCase();

    let hit:any = null;
    if (!hit && b && byBarcode.has(b)) hit = byBarcode.get(b);
    if (!hit && s && bySku.has(s)) hit = bySku.get(s);
    if (!hit && n) {
      hit = list.find(p => (p.name || '').toString().toLowerCase().includes(n));
    }

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

  // Persist summary
  await addDoc(collection(db, 'venues', venueId, 'salesReportMatches'), {
    reportId,
    counts: { total: report.lines?.length || 0, matched: matches.length, unknowns: unknowns.length },
    matches,
    period: report.period || {},
    createdAt: serverTimestamp(),
  });

  // Persist unknowns (each as its own doc so managers can map later)
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
