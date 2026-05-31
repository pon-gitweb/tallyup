// @ts-nocheck
import { collection, getDocs, query, where, Timestamp, doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';

export async function writeWeeklySnapshot(venueId: string, weekNumber: number): Promise<void> {
  const now = new Date();
  const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Sessions in window
  let sessions: any[] = [];
  try {
    const snap = await getDocs(collection(db, 'venues', venueId, 'sessions'));
    sessions = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(s => {
        const ts = s.completedAt?.toDate?.();
        return ts && ts >= weekStart && ts <= now;
      });
  } catch {}

  // Transfers in window
  let transfers: any[] = [];
  try {
    const snap = await getDocs(collection(db, 'venues', venueId, 'transfers'));
    transfers = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(t => {
        const ts = t.createdAt?.toDate?.();
        return ts && ts >= weekStart && ts <= now;
      });
  } catch {}

  // Requests in window
  let requests: any[] = [];
  try {
    const snap = await getDocs(collection(db, 'venues', venueId, 'requests'));
    requests = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(r => {
        const ts = r.createdAt?.toDate?.();
        return ts && ts >= weekStart && ts <= now;
      });
  } catch {}

  // Wastage totals in window
  const wastageTotals: Record<string, number> = {};
  try {
    const snap = await getDocs(collection(db, 'venues', venueId, 'wastage'));
    snap.docs.forEach(d => {
      const data = d.data() as any;
      const ts = data.createdAt?.toDate?.();
      if (ts && ts >= weekStart && ts <= now) {
        const pid = data.itemId || data.productId;
        if (pid) wastageTotals[pid] = (wastageTotals[pid] || 0) + (data.quantity || 0);
      }
    });
  } catch {}

  // Bar stock snapshot (current totals at time of writing)
  const barStockAtClose: Record<string, { name: string; total: number }> = {};
  try {
    const deptsSnap = await getDocs(
      query(collection(db, 'venues', venueId, 'departments'), where('isFestivalBar', '==', true)),
    );
    for (const deptDoc of deptsSnap.docs) {
      const itemsSnap = await getDocs(
        collection(db, 'venues', venueId, 'departments', deptDoc.id, 'areas', 'back-of-house', 'items'),
      );
      itemsSnap.docs.forEach(d => {
        const data = d.data() as any;
        const pid = d.id;
        if (!barStockAtClose[pid]) {
          barStockAtClose[pid] = { name: data.name || pid, total: 0 };
        }
        barStockAtClose[pid].total += data.lastCount ?? 0;
      });
    }
  } catch {}

  // Orders in window
  let ordersInWeek: any[] = [];
  try {
    const snap = await getDocs(collection(db, 'venues', venueId, 'orders'));
    ordersInWeek = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(o => {
        const ts = o.createdAt?.toDate?.();
        return ts && ts >= weekStart && ts <= now;
      });
  } catch {}

  // Aggregate sold quantities from sessions
  const soldTotals: Record<string, { name: string; sold: number }> = {};
  sessions.forEach(s => {
    (s.counts || []).forEach((c: any) => {
      if (!c.productId) return;
      if (!soldTotals[c.productId]) soldTotals[c.productId] = { name: c.productName || c.productId, sold: 0 };
      soldTotals[c.productId].sold += Math.abs(c.variance || 0);
    });
  });

  // Sales data summary for this week
  let salesDataSummary: {
    hasActualSales: boolean;
    salesSource: string | null;
    totalUnitsSold: number;
    totalRevenue: number | null;
    confidence: 'high' | 'medium' | 'low';
  } = { hasActualSales: false, salesSource: null, totalUnitsSold: 0, totalRevenue: null, confidence: 'low' };

  try {
    const salesSnap = await getDocs(
      query(
        collection(db, 'venues', venueId, 'event', 'details', 'salesData'),
        where('periodStart', '>=', Timestamp.fromDate(weekStart)),
        where('periodEnd', '<=', Timestamp.fromDate(now)),
      )
    );
    if (!salesSnap.empty) {
      let totalUnits = 0;
      let totalRevenue: number | null = null;
      let salesSource = 'pos-upload';
      for (const uploadDoc of salesSnap.docs) {
        const data = uploadDoc.data() as any;
        if (data.source === 'manual-entry') salesSource = 'manual-entry';
        for (const line of (data.lineItems || [])) {
          totalUnits += line.unitsSold || 0;
          if (line.revenue != null) {
            if (totalRevenue === null) totalRevenue = 0;
            totalRevenue += line.revenue;
          }
        }
      }
      salesDataSummary = {
        hasActualSales: true,
        salesSource,
        totalUnitsSold: totalUnits,
        totalRevenue,
        confidence: salesSource === 'pos-upload' ? 'high' : 'medium',
      };
    }
  } catch {}

  const snapshot = {
    weekNumber,
    weekStart: weekStart.toISOString(),
    weekEnd: now.toISOString(),
    sessionCount: sessions.length,
    transferCount: transfers.length,
    requestCount: requests.length,
    orderCount: ordersInWeek.length,
    soldTotals,
    wastageTotals,
    barStockAtClose,
    salesData: salesDataSummary,
    createdAt: serverTimestamp(),
  };

  await setDoc(
    doc(db, 'venues', venueId, 'event', 'details', 'weeklySnapshots', `week-${weekNumber}`),
    snapshot,
  );
}
