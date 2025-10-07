// @ts-nocheck
import {
  collection, getDocs, query, where, doc, getDoc,
} from 'firebase/firestore';
import { db } from '../firebase';
import { CountRow, InvoiceRow, SalesRow } from './varianceEngine';

const dlog = (...a:any[]) => { if (__DEV__) console.log('[variance.adapters]', ...a); };

type Window = { from?: number; to?: number }; // epoch ms

/** Counts adapter (end-of-window snapshot with expected/par) */
export async function fetchCounts(venueId:string, window:Window, departmentId?:string): Promise<CountRow[]> {
  try {
    // Try a few known shapes (document with arrays)
    const docPaths = [
      `venues/${venueId}/reports/latestCounts`,                 // { rows:[{sku,onHand,expected,unitCost,...}] }
      `venues/${venueId}/computed/latestCounts`,
      departmentId ? `venues/${venueId}/departments/${departmentId}/reports/latestCounts` : null,
    ].filter(Boolean) as string[];

    for (const p of docPaths) {
      const snap = await getDoc(doc(db, p));
      if (snap.exists()) {
        const rows = (snap.data()?.rows ?? snap.data()?.items ?? []) as any[];
        return rows.map(r => ({
          sku: String(r.sku || ''),
          name: r.name,
          unitCost: Number.isFinite(r.unitCost) ? r.unitCost : undefined,
          departmentId: r.department,
          onHand: Number(r.onHand || 0),
          expected: Number.isFinite(r.expected) ? r.expected : undefined,
        }));
      }
    }
  } catch (e) {
    dlog('counts error', e?.message || String(e));
  }
  return [];
}

/** Sales adapter (windowed) */
export async function fetchSales(venueId:string, window:Window, departmentId?:string): Promise<SalesRow[]> {
  try {
    const col = collection(db, `venues/${venueId}/sales`);
    const q = col; // For now we don’t assume index availability; window filter can be added when indexes exist
    const snap = await getDocs(q);
    const out: SalesRow[] = [];
    snap.forEach(d => {
      const s = d.data() as any;
      // Accept either flattened rows or nested lines
      const lines: any[] = Array.isArray(s?.lines) ? s.lines : [s];
      for (const L of lines) {
        if (!L?.sku) continue;
        out.push({ sku: String(L.sku), qty: Number(L.qty || 0) });
      }
    });
    return out;
  } catch (e) {
    dlog('sales error', e?.message || String(e));
    return [];
  }
}

/** Invoices adapter (windowed) */
export async function fetchInvoices(venueId:string, window:Window, departmentId?:string): Promise<InvoiceRow[]> {
  try {
    const col = collection(db, `venues/${venueId}/invoices`);
    const q = col;
    const snap = await getDocs(q);
    const out: InvoiceRow[] = [];
    snap.forEach(d => {
      const inv = d.data() as any;
      const lines: any[] = Array.isArray(inv?.lines) ? inv.lines : [inv];
      for (const L of lines) {
        if (!L?.sku) continue;
        out.push({ sku: String(L.sku), qty: Number(L.qty || 0) });
      }
    });
    return out;
  } catch (e) {
    dlog('invoices error', e?.message || String(e));
    return [];
  }
}
