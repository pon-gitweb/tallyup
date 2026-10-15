import { db } from '../firebase';
import {
  collection, getDocs, doc, getDoc, setDoc, writeBatch, deleteDoc,
  query, where, orderBy, limit, serverTimestamp, Timestamp,
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { resolveProductChain, type ProdEntry } from '../products/resolveProduct';
import { isReportActive } from '../sales/isReportActive';
import { loadSnapshotItems } from '../../utils/snapshotItems';
import { normaliseName, productKey, toProductItems } from '../../utils/productSnapshotItems';
import { getParLevel } from '../../utils/productFields';

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
 * Pre-resolved product id maps, built from the venue products collection in
 * writeDepartmentSnapshot before calling computeSnapshotItemFigures.
 *
 * Optional with a safe empty-map default — all 23 existing test call sites
 * pass nothing here and remain unaffected; matching degrades to today's
 * exact-id/name-only behavior when either map is empty.
 */
export type ProductResolution = {
  /** Maps any product id → its resolved (survivor) product id. */
  resolvedIdById: Record<string, string>;
  /** Maps lowercased product name → resolved (survivor) product id. */
  resolvedIdByName: Record<string, string>;
};

const EMPTY_RESOLUTION: ProductResolution = { resolvedIdById: {}, resolvedIdByName: {} };

/**
 * Supplier id / name keyed by product document id (includes all inactive /
 * merged products so that a lookup via _resolvedProductId — which is already
 * walked to the survivor — finds the survivor's current supplier info).
 *
 * Built from the venue products QuerySnapshot that writeDepartmentSnapshot
 * already fetches — no extra Firestore read required.
 */
export type SupplierResolution = {
  supplierInfoByProductId: Record<string, { supplierId: string | null; supplierName: string | null }>;
};

const EMPTY_SUPPLIER_RESOLUTION: SupplierResolution = { supplierInfoByProductId: {} };

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
  productResolution: ProductResolution = EMPTY_RESOLUTION,
  supplierResolution: SupplierResolution = EMPTY_SUPPLIER_RESOLUTION,
  baselineCycleNumber?: number,
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
    // Resolve through mergedInto chain once — used in STEP A, A2, and PO-discrepancy.
    // Falls back to the raw productId when the map is empty (safe degrade).
    const _resolvedProductId: string | null = item.productId
      ? (productResolution.resolvedIdById[item.productId] ?? item.productId)
      : null;

    const openingCount: number | null = cycleNumber > 0
      ? ((_resolvedProductId != null && prevItemMap.has(_resolvedProductId))
          ? prevItemMap.get(_resolvedProductId)!
          : prevItemMap.has(rawName) ? prevItemMap.get(rawName)! : null)
      : null;

    const actualClosing = typeof item.lastCount === 'number' ? item.lastCount : 0;
    const costPrice = typeof item.costPrice === 'number' ? item.costPrice : null;
    const parLevel = typeof item.parLevel === 'number' ? item.parLevel : null;

    if (openingCount != null) hasBaseline = true;
    if (costPrice != null) { hasPrices = true; totalPricedItems++; }

    const totalVarianceQty = openingCount != null ? actualClosing - openingCount : 0;
    const totalVarianceDollars = costPrice != null ? totalVarianceQty * costPrice : null;

    // Supplier info stamped from the resolved product — uses the already-fetched
    // productsSnap data passed in via supplierResolution (no extra Firestore read).
    // _resolvedProductId is the survivor id after walking the mergedInto chain,
    // so this always reflects the canonical supplier at write time.
    const _supplierInfo = _resolvedProductId
      ? (supplierResolution.supplierInfoByProductId[_resolvedProductId] ?? null)
      : null;

    return {
      productId: item.productId ?? null,
      name: item.name || null,
      areaId: item._areaId,
      areaName: item._areaName,
      categoryName: item.category ?? item.categorySuggested ?? null,
      supplierId: _supplierInfo?.supplierId ?? null,
      supplierName: _supplierInfo?.supplierName ?? null,

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
        : baselineCycleNumber != null
          ? `Baseline from cycle ${baselineCycleNumber}`
          : 'Baseline from previous cycle snapshot',

      lastCountBy: item.lastCountBy || null,
      lastCountByName: item.lastCountByName || null,
      lastCountAt: item.lastCountAt || null,

      areas: item._areas ?? null,
      varianceReliable: item._ambiguous === true ? false : (item._areas != null ? true : undefined),
      ambiguousName: item._ambiguous === true || undefined,

      _rawProductId: item.productId || null,
      _resolvedProductId,
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
      // Resolve the invoice line's id too — symmetric match handles the reverse
      // case where the invoice was filed under an old/inactive id but the item has
      // already been re-pointed to the survivor (or vice versa).
      const resolvedLineProductId = lineProductId
        ? (productResolution.resolvedIdById[lineProductId] ?? lineProductId)
        : null;
      const lineName = (line.productName || line.name || '').toLowerCase().trim();
      const lineQty = typeof line.qty === 'number' ? line.qty :
                      typeof line.quantity === 'number' ? line.quantity : 0;
      const lineUnitCost = typeof line.unitCost === 'number' ? line.unitCost :
                           typeof line.cost === 'number' ? line.cost :
                           typeof line.unitPrice === 'number' ? line.unitPrice :
                           typeof line.price === 'number' ? line.price : 0;
      const match = snapshotItems.find(si =>
        (si._rawProductId && lineProductId && si._rawProductId === lineProductId) ||
        // Symmetric resolved-id match: both item and invoice line ids walked to their
        // survivor — catches all four combinations of old/new id on either side.
        (si._resolvedProductId && resolvedLineProductId &&
          si._resolvedProductId === resolvedLineProductId) ||
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
  // Sales lines carry no productId, so we match by name first.
  // The resolvedIdByName fallback handles the cross-name case: a sales line uses the
  // survivor's name while the stocktake item still carries the old product name.
  let hasSales = false;
  for (const line of salesLines) {
    const resolvedByName = productResolution.resolvedIdByName[line.name];
    const match = snapshotItems.find(si =>
      si._rawName === line.name ||
      (resolvedByName != null && si._resolvedProductId === resolvedByName),
    );
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

  // STEP A3 — Pricing tier classification
  // Tier 1 'stamped': item carries its own costPrice (from stocktake entry or product stamp).
  // Tier 2 'invoice_verified': no stamped costPrice but _invoiceUnitCost matched this cycle.
  // 'none': neither. Never falls back to a product's current price.
  //
  // This is deliberate, not a gap (revisited 2026-09-10): Stock Holding intentionally
  // falls back to a product's current price because it reports stock value *today*.
  // Variance reports the cost of *this cycle's* shrinkage, so substituting today's
  // price for an unpriced historical item would misstate cycles where price has
  // since moved. A 'none' item stays genuinely unpriced here rather than estimated.
  // If this needs revisiting, the discussion and StockHoldingScreen.tsx comparison
  // are the reference point — don't re-diagnose this as a bug from scratch.
  for (const si of snapshotItems) {
    if (si.costPrice != null) {
      si.costPriceTier = 'stamped';
      si.displayCostPrice = si.costPrice;
    } else if (si._invoiceUnitCost != null) {
      si.costPriceTier = 'invoice_verified';
      si.displayCostPrice = si._invoiceUnitCost;
    } else {
      si.costPriceTier = 'none';
      si.displayCostPrice = null;
    }
    si.displayTotalVarianceDollars = si.displayCostPrice != null
      ? si.totalVarianceQty * si.displayCostPrice : null;
    si.displayUnexplainedVarianceDollars = si.displayCostPrice != null
      ? si.unexplainedVarianceQty * si.displayCostPrice : null;
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

    // Build product resolution maps for mergedInto-aware matching in STEP A/A2/PO.
    // Fails safe: any error leaves both maps empty → every match degrades to today's behavior.
    const productResolution: ProductResolution = { resolvedIdById: {}, resolvedIdByName: {} };
    // Declared before the try block so both productResolution and supplierResolution
    // are built in the same pass — productsSnap stays in scope for both.
    const supplierResolution: SupplierResolution = { supplierInfoByProductId: {} };
    const parByProductId: Record<string, number | null> = {}; // resolved product id → parLevel
    const liveProductIds = new Set<string>(); // survivor ids only (docs with no mergedInto)
    try {
      const productsSnap = await getDocs(collection(db, 'venues', venueId, 'products'));
      // ProdEntry shape matches resolveProductChain()'s expectations — same type used by
      // src/services/products/resolveProduct.ts (shared, no duplicate logic here).
      const prodById: Record<string, ProdEntry> = {};
      const rawParByDocId: Record<string, number | null> = {};
      productsSnap.forEach(d => {
        const p = d.data() as any;
        prodById[d.id] = {
          name: (p.name || '').toLowerCase().trim(),
          category: p.category ?? p.categorySuggested ?? 'Uncategorised',
          costPrice: typeof p.costPrice === 'number' ? p.costPrice : undefined,
          active: typeof p.active === 'boolean' ? p.active : undefined,
          mergedInto: p.mergedInto ?? null,
        };
        rawParByDocId[d.id] = getParLevel(p);
        // Supplier info stamped in the same pass — no extra Firestore read required.
        // Firestore product schema fields: primarySupplierId / primarySupplierName.
        supplierResolution.supplierInfoByProductId[d.id] = {
          supplierId: typeof p.primarySupplierId === 'string' && p.primarySupplierId ? p.primarySupplierId : null,
          supplierName: typeof p.primarySupplierName === 'string' && p.primarySupplierName ? p.primarySupplierName : null,
        };
      });
      productsSnap.forEach(d => {
        const survivorId = resolveProductChain(d.id, prodById);
        if (survivorId != null) {
          productResolution.resolvedIdById[d.id] = survivorId;
          const name = prodById[d.id].name;
          if (name) productResolution.resolvedIdByName[name] = survivorId;
          // parLevel from survivor doc — rawParByDocId[survivorId] is the survivor's value
          if (parByProductId[survivorId] === undefined) {
            parByProductId[survivorId] = rawParByDocId[survivorId] ?? null;
          }
        }
      });
      // liveProductIds = all survivor ids (values of resolvedIdById, which are final chain endpoints)
      for (const v of Object.values(productResolution.resolvedIdById)) liveProductIds.add(v);
    } catch (e: any) {
      console.warn('[snapshotWriter] product/supplier resolution build failed (safe degrade):', e?.message);
    }

    // Read department name + previous cycle date
    const deptRef = doc(db, 'venues', venueId, 'departments', departmentId);
    const deptSnap = await getDoc(deptRef);
    const deptData = deptSnap.exists() ? (deptSnap.data() as any) : {};
    const departmentName: string = deptData.name || departmentId;

    // ── Load previous cycle snapshot for openingCount — with gap fallback ────
    const prevItemMap = new Map<string, number>(); // productId or name.toLowerCase() → actualClosing
    let baselineCycleNumber: number | undefined;
    let baselineGapNote: string | null = null;
    if (cycleNumber > 0) {
      try {
        const prevSnapshotId = `cycle-${cycleNumber - 1}`;
        const prevSnap = await getDoc(
          doc(db, 'venues', venueId, 'departments', departmentId, 'snapshots', prevSnapshotId),
        );
        if (prevSnap.exists()) {
          const prevData = prevSnap.data() as any;
          const prevItems = await loadSnapshotItems(prevData, () =>
            getDocs(collection(db, 'venues', venueId, 'departments', departmentId, 'snapshots', prevSnapshotId, 'itemChunks'))
              .then(s => s.docs.map(d => d.data() as { index: number; items: any[] }))
          );
          for (const item of toProductItems(prevItems, prevData.itemsGranularity, liveProductIds)) {
            if (item.varianceReliable === false) continue;
            const pKey = productKey(item, liveProductIds);
            if (typeof item.actualClosing === 'number') {
              if (pKey) prevItemMap.set(pKey, item.actualClosing);
              const nameKey = normaliseName(item.name);
              if (nameKey && nameKey !== pKey) prevItemMap.set(nameKey, item.actualClosing);
            }
          }
          baselineCycleNumber = cycleNumber - 1;
        } else if (cycleNumber > 1) {
          // cycle-{n-1} missing — find most recent earlier snapshot (single-field query)
          try {
            const fallbackSnap = await getDocs(query(
              collection(db, 'venues', venueId, 'departments', departmentId, 'snapshots'),
              where('cycleNumber', '<', cycleNumber),
              orderBy('cycleNumber', 'desc'),
              limit(1),
            ));
            if (!fallbackSnap.empty) {
              const fallbackDoc = fallbackSnap.docs[0];
              const fallbackData = fallbackDoc.data() as any;
              const m = fallbackData.cycleNumber as number;
              baselineCycleNumber = m;
              const missingCycles = Array.from(
                { length: cycleNumber - 1 - m },
                (_, i) => m + 1 + i,
              );
              baselineGapNote = `Compared with cycle ${m}; cycle(s) ${missingCycles.join(', ')} were not saved`;
              const fallbackItems = await loadSnapshotItems(fallbackData, () =>
                getDocs(collection(db, 'venues', venueId, 'departments', departmentId, 'snapshots', fallbackDoc.id, 'itemChunks'))
                  .then(s => s.docs.map(d => d.data() as { index: number; items: any[] }))
              );
              for (const item of toProductItems(fallbackItems, fallbackData.itemsGranularity, liveProductIds)) {
                if (item.varianceReliable === false) continue;
                const pKey = productKey(item, liveProductIds);
                if (typeof item.actualClosing === 'number') {
                  if (pKey) prevItemMap.set(pKey, item.actualClosing);
                  const nameKey = normaliseName(item.name);
                  if (nameKey && nameKey !== pKey) prevItemMap.set(nameKey, item.actualClosing);
                }
              }
              console.warn('[snapshotWriter] baseline fallback used:', baselineGapNote);
            }
          } catch (e: any) {
            console.warn('[snapshotWriter] baseline fallback query failed:', e?.message);
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
          if (!isReportActive(salesData)) continue;
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

    // ── Aggregate per-area rawItems to product-level ─────────────────────────
    // Two-pass aggregation so rows with stale/area-row productIds group with the
    // live product via name lookup. Ambiguous names (those mapping to >1 distinct
    // survivor) are NOT added to nameToProductId — unlinked rows with such names
    // get key 'name:'+n with _ambiguous=true so varianceReliable is set false.
    //   Pass 1 — for every row whose resolved id is a live product doc, record
    //            normalisedName → Set<survivorId>. Names with exactly one survivor
    //            are added to nameToProductId.
    //   Pass 2 — key = live resolved productId if present; else
    //            nameToProductId[name] if present; else 'name:'+normalisedName.
    const nameToSurvivorIds = new Map<string, Set<string>>();
    for (const item of rawItems) {
      if (!item.productId) continue;
      const rPid = productResolution.resolvedIdById[item.productId] ?? item.productId;
      if (liveProductIds.has(rPid)) {
        const n = normaliseName(item.name);
        if (n) {
          if (!nameToSurvivorIds.has(n)) nameToSurvivorIds.set(n, new Set());
          nameToSurvivorIds.get(n)!.add(rPid);
        }
      }
    }
    const nameToProductId = new Map<string, string>();
    for (const [n, pids] of nameToSurvivorIds) {
      if (pids.size === 1) nameToProductId.set(n, [...pids][0]);
    }

    type AggEntry = { base: any; areas: any[]; sumLastCount: number; areaNames: Set<string>; groupPid: string | null; ambiguous: boolean };
    const aggMap = new Map<string, AggEntry>();
    for (const item of rawItems) {
      const n = normaliseName(item.name);
      let groupPid: string | null = null;
      let key: string;
      let isAmbiguous = false;
      if (item.productId) {
        const rPid = productResolution.resolvedIdById[item.productId] ?? item.productId;
        if (liveProductIds.has(rPid)) {
          groupPid = rPid;
          key = rPid;
        } else {
          isAmbiguous = (nameToSurvivorIds.get(n)?.size ?? 0) > 1;
          groupPid = nameToProductId.get(n) ?? null;
          key = groupPid ?? ('name:' + n);
        }
      } else {
        isAmbiguous = (nameToSurvivorIds.get(n)?.size ?? 0) > 1;
        groupPid = nameToProductId.get(n) ?? null;
        key = groupPid ?? ('name:' + n);
      }
      const lastCnt = typeof item.lastCount === 'number' ? item.lastCount : 0;
      const areaEntry = {
        areaId: item._areaId ?? null,
        areaName: item._areaName ?? null,
        areaItemId: item._id ?? null,
        actualClosing: lastCnt,
        lastCountAt: item.lastCountAt ?? null,
        lastCountBy: item.lastCountBy ?? null,
        lastCountByName: item.lastCountByName ?? null,
      };
      if (!aggMap.has(key)) {
        aggMap.set(key, { base: item, areas: [areaEntry], sumLastCount: lastCnt, areaNames: new Set([item._areaName ?? '']), groupPid, ambiguous: isAmbiguous });
      } else {
        const e = aggMap.get(key)!;
        e.areas.push(areaEntry);
        e.sumLastCount += lastCnt;
        if (item._areaName) e.areaNames.add(item._areaName);
        if (!e.groupPid && groupPid) e.groupPid = groupPid;
        if (isAmbiguous) e.ambiguous = true;
      }
    }
    const areaRowsCounted = rawItems.length;
    const aggregatedRawItems = Array.from(aggMap.values()).map(({ base, areas, sumLastCount, areaNames, groupPid, ambiguous }) => {
      const distinctNames = [...areaNames].filter(Boolean);
      const productParLevel = groupPid != null && parByProductId[groupPid] != null
        ? parByProductId[groupPid]
        : (typeof base.parLevel === 'number' ? base.parLevel : null);
      return {
        ...base,
        productId: groupPid ?? null,
        _ambiguous: ambiguous || undefined,
        lastCount: sumLastCount,
        _areaId: areas.length === 1 ? areas[0].areaId : null,
        _areaName: distinctNames.join(', ') || base._areaName,
        _areas: areas,
        parLevel: productParLevel,
      };
    });

    // ── Pure computation ──────────────────────────────────────────────────────
    const { snapshotItems, hasBaseline, hasPrices, totalPricedItems, hasInvoices, hasSales, likelyMissingInvoices } =
      computeSnapshotItemFigures(aggregatedRawItems, prevItemMap, cycleNumber, allInvoiceLines, salesLines, productResolution, supplierResolution, baselineCycleNumber);

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
            const lineProductId = line.productId || lineDoc.id || null;
            const resolvedLineProductId = lineProductId
              ? (productResolution.resolvedIdById[lineProductId] ?? lineProductId)
              : null;
            const match = snapshotItems.find(si =>
              (si._rawProductId && lineProductId && si._rawProductId === lineProductId) ||
              (si._resolvedProductId && resolvedLineProductId &&
                si._resolvedProductId === resolvedLineProductId) ||
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
                supplierId: orderData.supplierId || null,
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
    const pricedItemPercent = aggregatedRawItems.length > 0
      ? Math.round((totalPricedItems / aggregatedRawItems.length) * 100)
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
      areaRowsCounted,
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
      itemsPricedByInvoice: snapshotItems.filter(si => si.costPriceTier === 'invoice_verified').length,
      itemsWithBaseline: snapshotItems.filter(si => si.openingCount != null).length,
      itemsWithoutBaseline: snapshotItems.filter(si => si.openingCount == null).length,
      displayTotalStockValue: snapshotItems.some(si => si.displayCostPrice != null)
        ? snapshotItems.reduce((s, si) => s + (si.displayCostPrice != null ? si.actualClosing * si.displayCostPrice : 0), 0)
        : null,
      displayTotalVarianceDollars: snapshotItems.some(si => si.displayCostPrice != null)
        ? snapshotItems.reduce((s, si) => s + (si.displayTotalVarianceDollars ?? 0), 0)
        : null,
      displayUnexplainedVarianceDollars: snapshotItems.some(si => si.displayCostPrice != null)
        ? snapshotItems.reduce((s, si) => s + (si.displayUnexplainedVarianceDollars ?? 0), 0)
        : null,
      pricingBackfillAppliedAt: null,
    };

    // Clean internal helpers from all items before writing
    const allCleanItems = snapshotItems.map(si => {
      const { _rawProductId, _resolvedProductId, _rawName, _invoiceUnitCost, ...rest } = si;
      return rest;
    });
    // Legacy inline field: keep first 200 for old app builds that read snapshot.items directly
    const cleanItems = allCleanItems.slice(0, 200);

    // Build subcollection chunks (≤200 items each) so readers get the full set
    const CHUNK_SIZE = 200;
    const itemChunks: any[][] = [];
    for (let i = 0; i < allCleanItems.length; i += CHUNK_SIZE) {
      itemChunks.push(allCleanItems.slice(i, i + CHUNK_SIZE));
    }
    const newChunkCount = itemChunks.length;

    // Read existing snapshot to learn how many stale chunk docs need deletion
    const snapshotId = `cycle-${cycleNumber}`;
    const snapshotDocRef = doc(db, 'venues', venueId, 'departments', departmentId, 'snapshots', snapshotId);
    let oldChunkCount = 0;
    try {
      const existingSnap = await getDoc(snapshotDocRef);
      if (existingSnap.exists()) oldChunkCount = (existingSnap.data() as any).itemChunkCount ?? 0;
    } catch {}

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
      baselineCycleNumber: baselineCycleNumber ?? null,
      baselineGapNote,
      itemsGranularity: 'product' as const,
      dataCompleteness,
      summary,
      items: cleanItems,
      itemCount: allCleanItems.length,
      itemChunkCount: newChunkCount,
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

    // Write snapshot doc + all chunks atomically; delete any stale chunk docs
    const chunksColRef = collection(db, 'venues', venueId, 'departments', departmentId, 'snapshots', snapshotId, 'itemChunks');
    const batch = writeBatch(db);
    batch.set(snapshotDocRef, snapshot);
    for (let i = 0; i < itemChunks.length; i++) {
      batch.set(doc(chunksColRef, String(i).padStart(3, '0')), { index: i, items: itemChunks[i] });
    }
    for (let i = newChunkCount; i < oldChunkCount; i++) {
      batch.delete(doc(chunksColRef, String(i).padStart(3, '0')));
    }
    await batch.commit();

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
      products: allCleanItems.length,
      areaRows: areaRowsCounted,
      chunks: newChunkCount,
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
