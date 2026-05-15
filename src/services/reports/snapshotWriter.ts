// @ts-nocheck
import { db } from '../firebase';
import {
  collection, getDocs, doc, getDoc, setDoc,
  query, where, orderBy, limit, serverTimestamp, Timestamp,
} from 'firebase/firestore';

function toMs(val: any): number | null {
  if (!val) return null;
  if (typeof val.toMillis === 'function') return val.toMillis();
  if (typeof val.toDate === 'function') return val.toDate().getTime();
  if (typeof val === 'number') return val;
  return null;
}

export async function writeDepartmentSnapshot(
  venueId: string,
  departmentId: string,
  cycleNumber: number,
): Promise<void> {
  try {
    // Read department name + previous cycle date
    const deptRef = doc(db, 'venues', venueId, 'departments', departmentId);
    const deptSnap = await getDoc(deptRef);
    const deptData = deptSnap.exists() ? (deptSnap.data() as any) : {};
    const departmentName: string = deptData.name || departmentId;

    // Read all areas + items in this department
    const areasSnap = await getDocs(
      collection(db, 'venues', venueId, 'departments', departmentId, 'areas'),
    );

    let cycleStart: Date | null = null;
    let cycleEnd: Date = new Date();
    const rawItems: any[] = [];

    for (const areaDoc of areasSnap.docs) {
      const areaData = areaDoc.data() as any;
      const areaName: string = areaData.name || areaDoc.id;

      const startedAtMs = toMs(areaData.startedAt);
      const completedAtMs = toMs(areaData.completedAt);
      if (startedAtMs) {
        const d = new Date(startedAtMs);
        if (!cycleStart || d < cycleStart) cycleStart = d;
      }
      if (completedAtMs) {
        const d = new Date(completedAtMs);
        if (d > cycleEnd) cycleEnd = d;
      }

      const itemsSnap = await getDocs(
        collection(db, 'venues', venueId, 'departments', departmentId, 'areas', areaDoc.id, 'items'),
      );
      itemsSnap.forEach(itemDoc => {
        rawItems.push({ _id: itemDoc.id, _areaId: areaDoc.id, _areaName: areaName, ...itemDoc.data() });
      });
    }

    // Calculate duration
    const durationMinutes = cycleStart
      ? Math.max(0, Math.round((cycleEnd.getTime() - cycleStart.getTime()) / 60000))
      : 0;

    // Days since last cycle (use the pre-increment value that was stored before this run)
    const prevCycleDateMs = cycleNumber > 1 ? toMs(deptData.lastCycleAt) : null;
    const daysSinceLastCycle = prevCycleDateMs
      ? Math.round((cycleEnd.getTime() - prevCycleDateMs) / (1000 * 60 * 60 * 24))
      : null;

    // Build per-item snapshot entries
    let hasBaseline = false;
    let hasPrices = false;
    let totalPricedItems = 0;

    const snapshotItems: any[] = rawItems.map(item => {
      const openingCount = typeof item.confirmedCount === 'number' ? item.confirmedCount : null;
      const actualClosing = typeof item.lastCount === 'number' ? item.lastCount : 0;
      const costPrice = typeof item.costPrice === 'number' ? item.costPrice : null;
      const parLevel = typeof item.parLevel === 'number' ? item.parLevel : null;

      if (openingCount != null) hasBaseline = true;
      if (costPrice != null) { hasPrices = true; totalPricedItems++; }

      const totalVarianceQty = actualClosing - (openingCount ?? 0);
      const totalVarianceDollars = costPrice != null ? totalVarianceQty * costPrice : null;

      return {
        productId: item._id,
        name: item.name || item._id,
        areaId: item._areaId,
        areaName: item._areaName,
        categoryName: item.category ?? item.categorySuggested ?? null,

        openingCount,
        receivedQty: 0,
        soldQty: null,
        theoreticalUsage: null,
        wastageQty: 0,
        expectedClosing: null,
        actualClosing,

        totalVarianceQty,
        explainedVarianceQty: 0,
        unexplainedVarianceQty: totalVarianceQty,

        costPrice,
        totalVarianceDollars,
        unexplainedVarianceDollars: totalVarianceDollars,

        parLevel,
        belowPAR: parLevel != null ? actualClosing < parLevel : false,
        dailyVelocity: null,
        daysOfCover: null,

        isNewProduct: openingCount == null,
        ranToZero: actualClosing === 0 && (openingCount ?? 0) > 0,
        hasUnexplainedGain: false,
        hasUnexplainedLoss: false,
        likelyMissingInvoice: false,

        varianceConfidence: openingCount != null ? 'high' : 'low',
        confidenceReason: openingCount == null
          ? 'No baseline — first cycle for this product'
          : 'Baseline exists',

        // Internal helpers for matching — stripped before write
        _rawProductId: item.productId || null,
        _rawName: (item.name || '').toLowerCase().trim(),
      };
    });

    // STEP A — Enrich with invoice data
    let hasInvoices = false;
    try {
      if (cycleStart) {
        const startTs = Timestamp.fromDate(cycleStart);
        const endTs = Timestamp.fromDate(cycleEnd);
        const invoicesSnap = await getDocs(
          query(
            collection(db, 'venues', venueId, 'invoices'),
            where('date', '>=', startTs),
            where('date', '<=', endTs),
          ),
        );

        for (const invDoc of invoicesSnap.docs) {
          const linesSnap = await getDocs(
            collection(db, 'venues', venueId, 'invoices', invDoc.id, 'lines'),
          );
          if (!linesSnap.empty) hasInvoices = true;

          linesSnap.forEach(lineDoc => {
            const line = lineDoc.data() as any;
            const lineProductId = line.productId || lineDoc.id;
            const lineQty = typeof line.qty === 'number' ? line.qty : 0;
            const match = snapshotItems.find(si =>
              (si._rawProductId && si._rawProductId === lineProductId) ||
              (si._rawName && si._rawName === (line.productName || '').toLowerCase().trim()),
            );
            if (match) {
              match.receivedQty = (match.receivedQty || 0) + lineQty;
              if (match.openingCount != null) {
                match.expectedClosing = match.openingCount + match.receivedQty;
                match.unexplainedVarianceQty = match.actualClosing - match.expectedClosing;
                if (match.costPrice != null) {
                  match.unexplainedVarianceDollars = match.unexplainedVarianceQty * match.costPrice;
                }
              }
            }
          });
        }
      }
    } catch { /* invoice enrichment is best-effort */ }

    // STEP B — Missing invoice detection (gain > 2 units with no invoice received)
    const likelyMissingInvoices: any[] = [];
    for (const si of snapshotItems) {
      if (si.totalVarianceQty > 2 && si.receivedQty === 0 && si.openingCount != null) {
        si.likelyMissingInvoice = true;
        si.hasUnexplainedGain = true;
        likelyMissingInvoices.push({
          type: 'missing_invoice',
          productId: si.productId,
          productName: si.name,
          unexplainedGainQty: si.totalVarianceQty,
          likelySuppliers: [],
          lastInvoiceDate: null,
        });
      }
      if (si.totalVarianceQty < -2 && si.openingCount != null) {
        si.hasUnexplainedLoss = true;
      }
    }

    // STEP C — PO reconciliation
    const poDiscrepancies: any[] = [];
    try {
      if (cycleStart) {
        const startTs = Timestamp.fromDate(cycleStart);
        const endTs = Timestamp.fromDate(cycleEnd);
        const ordersSnap = await getDocs(
          query(
            collection(db, 'venues', venueId, 'orders'),
            where('status', 'in', ['received', 'invoiced']),
            where('updatedAt', '>=', startTs),
            where('updatedAt', '<=', endTs),
          ),
        );
        for (const orderDoc of ordersSnap.docs) {
          const orderData = orderDoc.data() as any;
          const orderLinesSnap = await getDocs(
            collection(db, 'venues', venueId, 'orders', orderDoc.id, 'lines'),
          );
          orderLinesSnap.forEach(lineDoc => {
            const line = lineDoc.data() as any;
            const orderedQty = typeof line.qty === 'number' ? line.qty : 0;
            const match = snapshotItems.find(si =>
              (si._rawProductId && si._rawProductId === (line.productId || lineDoc.id)) ||
              (si._rawName && si._rawName === (line.productName || line.name || '').toLowerCase().trim()),
            );
            if (match && orderedQty > 0 && match.receivedQty < orderedQty) {
              poDiscrepancies.push({
                type: 'po_discrepancy',
                productId: match.productId,
                productName: match.name,
                orderedQty,
                receivedQty: match.receivedQty,
                supplierName: orderData.supplierName || null,
              });
            }
          });
        }
      }
    } catch { /* PO reconciliation is best-effort */ }

    // STEP D — Recommendations
    const recommendations: any[] = [];
    for (const si of snapshotItems) {
      if (si.belowPAR && recommendations.length < 10) {
        recommendations.push({
          priority: 'high',
          type: 'reorder',
          productId: si.productId,
          message: `${si.name} is below PAR (${si.actualClosing} of ${si.parLevel})`,
          action: 'Add to next order',
        });
      }
    }
    for (const mi of likelyMissingInvoices.slice(0, 5)) {
      recommendations.push({
        priority: 'medium',
        type: 'missing_invoice',
        productId: mi.productId,
        message: `${mi.productName} increased ${mi.unexplainedGainQty} units — no invoice recorded`,
        action: 'Scan missing invoice',
      });
    }
    for (const pd of poDiscrepancies.slice(0, 5)) {
      recommendations.push({
        priority: 'high',
        type: 'investigate',
        productId: pd.productId,
        message: `Order shortfall: ${pd.productName} — ordered ${pd.orderedQty}, received ${pd.receivedQty}`,
        action: 'Chase with supplier',
      });
    }

    // Build summary
    const pricedItems = snapshotItems.filter(si => si.costPrice != null);
    const totalStockValue = hasPrices
      ? pricedItems.reduce((s, si) => s + si.actualClosing * si.costPrice, 0)
      : null;
    const totalVarianceDollars = hasPrices
      ? snapshotItems.reduce((s, si) => s + (si.totalVarianceDollars ?? 0), 0)
      : null;
    const unexplainedVarianceDollars = hasPrices
      ? snapshotItems.reduce((s, si) => s + (si.unexplainedVarianceDollars ?? 0), 0)
      : null;
    const pricedItemPercent = rawItems.length > 0
      ? Math.round((totalPricedItems / rawItems.length) * 100)
      : 0;

    const dataCompleteness = {
      hasBaseline,
      hasInvoices,
      hasSales: false,
      hasRecipes: false,
      hasWastage: false,
      hasPrices,
      tier: hasInvoices ? 2 : 1,
      pricedItemPercent,
      invoiceCoverage: 0,
      salesCoverage: 0,
    };

    const summary = {
      totalItemsCounted: snapshotItems.length,
      totalItemsWithVariance: snapshotItems.filter(si => si.totalVarianceQty !== 0).length,
      totalStockValue,
      totalVarianceQty: snapshotItems.reduce((s, si) => s + si.totalVarianceQty, 0),
      totalVarianceDollars,
      unexplainedVarianceQty: snapshotItems.reduce((s, si) => s + si.unexplainedVarianceQty, 0),
      unexplainedVarianceDollars,
      itemsBelowPAR: snapshotItems.filter(si => si.belowPAR).length,
      itemsAtZero: snapshotItems.filter(si => si.actualClosing === 0).length,
      itemsWithNoPrice: snapshotItems.filter(si => si.costPrice == null).length,
      itemsWithPositiveVariance: snapshotItems.filter(si => si.totalVarianceQty > 0).length,
      itemsWithNegativeVariance: snapshotItems.filter(si => si.totalVarianceQty < 0).length,
    };

    // Clean internal helpers from items before writing
    const cleanItems = snapshotItems.slice(0, 200).map(si => {
      const { _rawProductId, _rawName, ...rest } = si;
      return rest;
    });

    const snapshot = {
      venueId,
      departmentId,
      departmentName,
      cycleNumber,
      completedAt: serverTimestamp(),
      cycleStart: cycleStart ? Timestamp.fromDate(cycleStart) : null,
      cycleEnd: Timestamp.fromDate(cycleEnd),
      daysSinceLastCycle,
      durationMinutes,
      dataCompleteness,
      summary,
      items: cleanItems,
      findings: {
        likelyMissingInvoices: likelyMissingInvoices.slice(0, 10),
        poDiscrepancies: poDiscrepancies.slice(0, 10),
        recipeAnomalies: [],
        patterns: [],
      },
      recommendations: recommendations.slice(0, 20),
    };

    // Write department snapshot
    const snapshotId = `cycle-${cycleNumber}`;
    await setDoc(
      doc(db, 'venues', venueId, 'departments', departmentId, 'snapshots', snapshotId),
      snapshot,
    );

    // Update venue-level latestSnapshot (lightweight, no items)
    const allDeptsSnap = await getDocs(collection(db, 'venues', venueId, 'departments'));
    const deptSummaries: any[] = [];
    for (const d of allDeptsSnap.docs) {
      if (d.id === departmentId) {
        deptSummaries.push({
          departmentId,
          departmentName,
          cycleNumber,
          completedAt: cycleEnd.toISOString(),
          summary,
          dataCompleteness,
        });
      } else {
        try {
          const latestSnap = await getDocs(
            query(
              collection(db, 'venues', venueId, 'departments', d.id, 'snapshots'),
              orderBy('completedAt', 'desc'),
              limit(1),
            ),
          );
          if (!latestSnap.empty) {
            const s = latestSnap.docs[0].data() as any;
            deptSummaries.push({
              departmentId: d.id,
              departmentName: (d.data() as any).name || d.id,
              cycleNumber: s.cycleNumber,
              completedAt: s.cycleEnd?.toDate?.()?.toISOString() || null,
              summary: s.summary,
              dataCompleteness: s.dataCompleteness,
            });
          }
        } catch {}
      }
    }

    await setDoc(doc(db, 'venues', venueId, 'latestSnapshot'), {
      updatedAt: serverTimestamp(),
      departments: deptSummaries,
      totalDepts: allDeptsSnap.size,
      deptsWithData: deptSummaries.length,
    });

    console.log(`[snapshotWriter] cycle-${cycleNumber} written for dept ${departmentId}`);
  } catch (e: any) {
    console.error('[snapshotWriter] failed:', e?.message || e);
    // Non-fatal — stocktake already completed
  }
}
