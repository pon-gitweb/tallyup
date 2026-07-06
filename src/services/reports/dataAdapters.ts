import {
  collection, getDocs, query, where, doc, getDoc,
} from 'firebase/firestore';
import { db } from '../firebase';
import { CountRow, InvoiceRow, SalesRow } from './varianceEngine';

const dlog = (...a:any[]) => { if (__DEV__) console.log('[variance.adapters]', ...a); };

type Window = { from?: number; to?: number }; // epoch ms

/** Counts adapter — traverses departments → areas → items live (same path as briefing.ts + Suitee) */
export async function fetchCounts(venueId: string, window: Window, departmentId?: string): Promise<CountRow[]> {
  try {
    const results: CountRow[] = [];

    // Load the target department(s)
    let deptDocs: any[];
    if (departmentId) {
      const snap = await getDoc(doc(db, 'venues', venueId, 'departments', departmentId));
      deptDocs = snap.exists() ? [snap] : [];
    } else {
      const snap = await getDocs(collection(db, 'venues', venueId, 'departments'));
      deptDocs = snap.docs;
    }

    for (const deptDoc of deptDocs) {
      const areasSnap = await getDocs(
        collection(db, 'venues', venueId, 'departments', deptDoc.id, 'areas'),
      );
      for (const areaDoc of areasSnap.docs) {
        const itemsSnap = await getDocs(
          collection(db, 'venues', venueId, 'departments', deptDoc.id, 'areas', areaDoc.id, 'items'),
        );
        for (const itemDoc of itemsSnap.docs) {
          const item = itemDoc.data();

          // Only items that have been counted at least once this cycle
          if (item.lastCount == null) continue;

          const confirmedCount = typeof item.confirmedCount === 'number' ? item.confirmedCount : null;
          const parLevel = typeof item.parLevel === 'number' ? item.parLevel : null;

          // Baseline: previous cycle count takes priority; fall back to PAR level for first cycle.
          // Skip items with no baseline — they would appear as false excess against zero.
          const expected = confirmedCount != null ? confirmedCount : parLevel;
          if (expected == null) continue;

          results.push({
            sku: itemDoc.id,
            name: item.name,
            unitCost: typeof item.costPrice === 'number' ? item.costPrice : undefined,
            departmentId: deptDoc.id,
            onHand: item.lastCount,
            expected,
          });
        }
      }
    }

    return results;
  } catch (e) {
    dlog('counts error', e?.message || String(e));
    return [];
  }
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
