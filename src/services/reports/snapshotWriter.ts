import { db } from '../firebase';
import {
  collection, getDocs, doc, getDoc, setDoc,
  query, where, orderBy, limit, serverTimestamp, Timestamp,
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

function toMs(val: any): number | null {
  if (!val) return null;
  if (typeof val.toMillis === 'function') return val.toMillis();
  if (typeof val.toDate === 'function') return val.toDate().getTime();
  if (typeof val === 'number') return val;
  return null;
}

// ── Exported for unit tests ──────────────────────────────────────────────────

export interface SnapshotLineRecord {
  productId?: string | null;
  _docId?: string;
  productName?: string;
  name?: string;
  qty?: number;
  quantity?: number;
  unitCost?: number;
  cost?: number;
  unitPrice?: number;
  price?: number;
}

export interface SnapshotSalesLine {
  name: string;   // already lowercased and trimmed
  qtySold: number;
}

/**
 * Pure computation: builds per-item snapshot figures from already-fetched data.
 * Wrapper responsibility: Firestore I/O only. This fn owns the math.
 *
 * allInvoiceLines: one entry per invoice, each an array of its line records
 * (subcollection shape OR inline array — both accepted via field tolerance).
 */
export function computeSnapshotItemFigures(
  rawItems: any[],
  prevItemMap: Map<string, number>,
  cycleNumber: number,
  allInvoiceLines: SnapshotLineRecord[][],
  salesLines: SnapshotSalesLine[],
): {
  snapshotItems: any[];
  hasBaseline: boolean;
  hasPrices: boolean;
  totalPricedItems: number;
  hasInvoices: boolean;
  hasSales: boolean;
  likelyMissingInvoices: any[];
} {
  let hasBaseline = false;
  let hasPrices = false;
  let totalPricedItems = 0;

  const snapshotItems: any[] = rawItems.map(item => {
    const rawName = (item.name || '').toLowerCase().trim();

    const openingCount: number | null = cycleNumber > 0
      ? (prevItemMap.has(rawName) ? prevItemMap.get(rawName)! : null)
      : null;

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
        ? (cycleNumber === 1 ? 'First cycle for department' : 'New product — no prior cycle')
        : 'Baseline from previous cycle snapshot',

      lastCountBy: item.lastCountBy || null,
      lastCountByName: item.lastCountByName || null,
      lastCountAt: item.lastCountAt || null,

      _rawProductId: item.productId || null,
      _rawName: rawName,
    };
  });

  // STEP A — Invoice enrichment (field-tolerant: qty/quantity, unitCost/cost/unitPrice/price,
  // productName/name, subcollection _docId as fallback productId)
  let hasInvoices = false;
  for (const lineRecords of allInvoiceLines) {
    if (lineRecords.length > 0) hasInvoices = true;
    for (const line of lineRecords) {
      const lineProductId = line.productId || line._docId || null;
      const lineName = (line.productName || line.name || '').toLowerCase().trim();
      const lineQty = typeof line.qty === 'number' ? line.qty :
                      typeof line.quantity === 'number' ? line.quantity : 0;
      const lineUnitCost = typeof line.unitCost === 'number' ? line.unitCost :
                           typeof line.cost === 'number' ? line.cost :
                           typeof line.unitPrice === 'number' ? line.unitPrice :
                           typeof line.price === 'number' ? line.price : 0;
      const match = snapshotItems.find(si =>
        (si._rawProductId && lineProductId && si._rawProductId === lineProductId) ||
        (si._rawName && lineName && si._rawName === lineName),
      );
      if (match) {
        match.receivedQty = (match.receivedQty || 0) + lineQty;
        if (!match._invoiceUnitCost && lineUnitCost > 0) {
          match._invoiceUnitCost = lineUnitCost;
        }
      }
    }
  }

  // STEP A2 — Sales enrichment (soldQty)
  let hasSales = false;
  for (const line of salesLines) {
    const match = snapshotItems.find(si => si._rawName === line.name);
    if (match) {
      match.soldQty = (match.soldQty ?? 0) + line.qtySold;
      hasSales = true;
    }
  }

  // Post-enrichment: set expectedClosing and unexplained figures once both receivedQty
  // and soldQty are final. Items with openingCount == null keep initialised defaults
  // (unexplained = total, confidence 'low').
  for (const si of snapshotItems) {
    if (si.openingCount == null) continue;
    si.expectedClosing = si.openingCount + (si.receivedQty || 0) - (si.soldQty ?? 0);
    si.unexplainedVarianceQty = si.actualClosing - si.expectedClosing;
    si.unexplainedVarianceDollars = si.costPrice != null
      ? si.unexplainedVarianceQty * si.costPrice : null;
  }

  // STEP B — Missing invoice detection + unexplained loss
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
    if (si.unexplainedVarianceQty < -2 && si.openingCount != null) {
      si.hasUnexplainedLoss = true;
    }
  }

  return { snapshotItems, hasBaseline, hasPrices, totalPricedItems, hasInvoices, hasSales, likelyMissingInvoices };
}

// ── I/O wrapper ──────────────────────────────────────────────────────────────

export async function writeDepartmentSnapshot(
  venueId: string,
  departmentId: string,
  cycleNumber: number,
): Promise<void> {
  try {
    // Capture completing user before any async ops
    const auth = getAuth();
    const completedBy: string | null = auth.currentUser?.uid || null;
    const completedByName: string | null = auth.currentUser?.displayName || null;

    // Read department name + previous cycle date
    const deptRef = doc(db, 'venues', venueId, 'departments', departmentId);
    const deptSnap = await getDoc(deptRef);
    const deptData = deptSnap.exists() ? (deptSnap.data() as any) : {};
    const departmentName: string = deptData.name || departmentId;

    // ── FIX 1: Load previous cycle snapshot for correct openingCount ──────────
    const prevItemMap = new Map<string, number>(); // name.toLowerCase() → actualClosing
    if (cycleNumber > 0) {
      try {
        const prevSnapshotId = `cycle-${cycleNumber - 1}`;
        const prevSnap = await getDoc(
          doc(db, 'venues', venueId, 'departments', departmentId, 'snapshots', prevSnapshotId),
        );
        if (prevSnap.exists()) {
          const prevData = prevSnap.data() as any;
          for (const item of (prevData.items || [])) {
            const key = (item.name || '').toLowerCase().trim();
            if (key && typeof item.actualClosing === 'number') {
              prevItemMap.set(key, item.actualClosing);
            }
          }
        }
      } catch (e: any) { console.warn('[snapshotWriter] previous snapshot read failed:', e?.message); }
    }

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

    // Days since last cycle
    const prevCycleDateMs = cycleNumber > 0 ? toMs(deptData.lastCycleAt) : null;
    const daysSinceLastCycle = prevCycleDateMs
      ? Math.round((cycleEnd.getTime() - prevCycleDateMs) / (1000 * 60 * 60 * 24))
      : null;

    // ── STEP A I/O: Gather invoice lines (subcollection or inline) ────────────
    // Matching happens in computeSnapshotItemFigures; wrapper resolves shape only.
    const allInvoiceLines: SnapshotLineRecord[][] = [];
    try {
      if (cycleStart) {
        const startTs = Timestamp.fromDate(cycleStart);
        const endTs = Timestamp.fromDate(cycleEnd);

        let invoiceDocs: any[] = [];
        try {
          const snap1 = await getDocs(query(
            collection(db, 'venues', venueId, 'invoices'),
            where('invoiceDateTimestamp', '>=', startTs),
            where('invoiceDateTimestamp', '<=', endTs),
          ));
          invoiceDocs = snap1.docs;
        } catch (e: any) { console.warn('[snapshotWriter] invoiceDateTimestamp query failed:', e?.message); }

        try {
          const snap2 = await getDocs(query(
            collection(db, 'venues', venueId, 'invoices'),
            where('date', '>=', startTs),
            where('date', '<=', endTs),
          ));
          const seenIds = new Set(invoiceDocs.map(d => d.id));
          for (const d of snap2.docs) {
            if (!seenIds.has(d.id)) invoiceDocs.push(d);
          }
        } catch (e: any) { console.warn('[snapshotWriter] date field query failed:', e?.message); }

        for (const invDoc of invoiceDocs) {
          const linesSnap = await getDocs(
            collection(db, 'venues', venueId, 'invoices', invDoc.id, 'lines'),
          );
          // Subcollection shape (receive.ts) takes precedence; inline array is the fallback
          // for ocrInvoicePhoto and desktop importers.
          const lineRecords: any[] = !linesSnap.empty
            ? linesSnap.docs.map(d => ({ _docId: d.id, ...d.data() }))
            : (invDoc.data().lines || []);
          allInvoiceLines.push(lineRecords);
        }
      }
    } catch (e: any) { console.warn('[snapshotWriter] invoice enrichment failed:', e?.message); }

    // ── STEP A2 I/O: Gather sales lines ──────────────────────────────────────
    const salesLines: SnapshotSalesLine[] = [];
    try {
      if (cycleStart) {
        const startIso = cycleStart.toISOString().slice(0, 10);
        const endIso = cycleEnd.toISOString().slice(0, 10);
        const salesSnap = await getDocs(
          collection(db, 'venues', venueId, 'salesReports'),
        );
        for (const salesDoc of salesSnap.docs) {
          const salesData = salesDoc.data() as any;
          const report = salesData.report;
          if (!report || !Array.isArray(report.lines)) continue;
          const periodStart = report.period?.start ?? null;
          const periodEnd = report.period?.end ?? null;
          const overlapStart = !periodEnd || periodEnd >= startIso;
          const overlapEnd = !periodStart || periodStart <= endIso;
          if (!overlapStart || !overlapEnd) continue;
          for (const line of report.lines) {
            const lineName = (line.name || '').toLowerCase().trim();
            const qtySold = typeof line.qtySold === 'number' ? line.qtySold : 0;
            if (!lineName || qtySold <= 0) continue;
            salesLines.push({ name: lineName, qtySold });
          }
        }
      }
    } catch (e: any) { console.warn('[snapshotWriter] sales enrichment failed:', e?.message); }

    // ── Pure computation ──────────────────────────────────────────────────────
    const { snapshotItems, hasBaseline, hasPrices, totalPricedItems, hasInvoices, hasSales, likelyMissingInvoices } =
      computeSnapshotItemFigures(rawItems, prevItemMap, cycleNumber, allInvoiceLines, salesLines);

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
            const lineName = (line.productName || line.name || '').toLowerCase().trim();
            const match = snapshotItems.find(si =>
              (si._rawProductId && si._rawProductId === (line.productId || lineDoc.id)) ||
              (si._rawName && lineName && si._rawName === lineName),
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
    } catch (e: any) { console.warn('[snapshotWriter] PO reconciliation failed:', e?.message); }

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

    // FIX 8 — Data quality validation
    const validationIssues: string[] = [];
    const allZeroVariance = snapshotItems.length > 0 && snapshotItems.every(si => si.totalVarianceQty === 0);
    if (allZeroVariance && cycleNumber > 1) {
      validationIssues.push('All variances are zero — possible data issue');
      console.warn('[Snapshot] All variances zero:', { venueId, departmentId, cycleNumber });
    }
    const missingBaselineCount = snapshotItems.filter(si => si.openingCount === null).length;
    if (missingBaselineCount === snapshotItems.length && snapshotItems.length > 0) {
      validationIssues.push(cycleNumber === 1
        ? 'First cycle — no baseline (expected)'
        : 'No baseline counts — previous snapshot missing',
      );
    }
    const dataQualityScore = validationIssues.length === 0
      ? 100
      : Math.max(0, 100 - (validationIssues.length * 25));

    const dataCompleteness = {
      hasBaseline,
      hasInvoices,
      hasSales,
      hasRecipes: false,
      hasWastage: false,
      hasPrices,
      tier: hasSales ? 3 : hasInvoices ? 2 : 1,
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
      const { _rawProductId, _rawName, _invoiceUnitCost, ...rest } = si;
      return rest;
    });

    const snapshot = {
      venueId,
      departmentId,
      departmentName,
      cycleNumber,
      completedAt: serverTimestamp(),
      requiresRecalculation: false,
      lastRecalculatedAt: serverTimestamp(),
      completedBy,
      completedByName,
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
      validationIssues,
      dataQualityScore,
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

    await setDoc(doc(db, 'venues', venueId, 'latestSnapshot', 'current'), {
      updatedAt: serverTimestamp(),
      departments: deptSummaries,
      totalDepts: allDeptsSnap.size,
      deptsWithData: deptSummaries.length,
    });

    console.log(`[snapshotWriter] cycle-${cycleNumber} written for dept ${departmentId}`, {
      items: cleanItems.length,
      hasBaseline,
      hasInvoices,
      hasSales,
      dataQualityScore,
      validationIssues,
    });
  } catch (e: any) {
    console.error('[snapshotWriter] failed:', e?.message || e);
    // Non-fatal — stocktake already completed
  }
}
