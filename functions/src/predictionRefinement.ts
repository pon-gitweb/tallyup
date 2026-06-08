import * as admin from "firebase-admin";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PriorYearProduct {
  productName: string;
  totalUsed: number;
  avgDailyVelocity: number;
  dataSource: "weekly-snapshot" | "sales-upload" | "session-count";
  confidence: "high" | "medium" | "low";
}

export interface ObligationMin {
  supplierName: string;
  minimumQty: number;
}

export interface ProductPrediction {
  productName: string;
  predictedQty: number;
  supplierId: string;
  supplierName: string;
}

export interface RefinementContext {
  event: {
    name: string;
    type: string;
    season: string;
    durationDays: number;
    isMultiDay: boolean;
    isWeekend: boolean;
    dailyAttendance: number;
    location: string | null;
    pricePositioning: string;
    operatorNote: string | null;
  };
  mathPrediction: Record<string, ProductPrediction[]>;
  historicalData: PriorYearProduct[];
  obligations: ObligationMin[];
  supplierNames: string[];
  hasHistory: boolean;
}

// ─── Season helper (NZ) ─────────────────────────────────────────────────────

export function getSeasonNZ(dateStr: string): string {
  try {
    // Handle DD/MM/YYYY format
    const parts = dateStr.split("/");
    const month = parts.length === 3
      ? parseInt(parts[1], 10)
      : new Date(dateStr).getMonth() + 1;
    if (isNaN(month)) return "unknown";
    if (month >= 12 || month <= 2) return "summer";
    if (month >= 3 && month <= 5) return "autumn";
    if (month >= 6 && month <= 8) return "winter";
    return "spring";
  } catch {
    return "unknown";
  }
}

// ─── Weekend helper ──────────────────────────────────────────────────────────

function isWeekendEvent(dateStr: string): boolean {
  try {
    const parts = dateStr.split("/");
    const date = parts.length === 3
      ? new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]))
      : new Date(dateStr);
    const day = date.getDay();
    return day === 0 || day === 5 || day === 6; // Sun/Fri/Sat
  } catch {
    return false;
  }
}

// ─── Category grouper ────────────────────────────────────────────────────────

function groupByCategory(mathResults: any[]): Record<string, ProductPrediction[]> {
  const groups: Record<string, ProductPrediction[]> = {};
  for (const r of mathResults) {
    const cat = (r.category || "na").toLowerCase();
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push({
      productName: r.productName,
      predictedQty: r.predictedQty,
      supplierId: r.supplierId || "",
      supplierName: r.supplierName || "",
    });
  }
  return groups;
}

// ─── Context builder ─────────────────────────────────────────────────────────

export async function buildRefinementContext(
  venueId: string,
  eventDetails: any,
  mathResults: any[],
  db: admin.firestore.Firestore,
): Promise<RefinementContext> {
  const season = getSeasonNZ(eventDetails.startDate || "");
  const eventDurationDays = parseInt(eventDetails.eventDurationDays ?? "1", 10) || 1;

  const historicalData = await loadPriorYearData(venueId, db, eventDurationDays);
  const obligations    = await loadObligations(venueId, db);
  const mathPrediction = groupByCategory(mathResults);

  const supplierNames = [...new Set(
    mathResults.map((r: any) => r.supplierName).filter(Boolean)
  )];

  return {
    event: {
      name:              eventDetails.eventName || "Festival",
      type:              eventDetails.eventType || "default",
      season,
      durationDays:      eventDurationDays,
      isMultiDay:        eventDurationDays > 1,
      isWeekend:         isWeekendEvent(eventDetails.startDate || ""),
      dailyAttendance:   parseInt(eventDetails.dailyAttendance ?? "500", 10) || 500,
      location:          eventDetails.location || null,
      pricePositioning:  eventDetails.pricePositioning || "mid_range",
      operatorNote:      eventDetails.operatorNote || null,
    },
    mathPrediction,
    historicalData,
    obligations,
    supplierNames,
    hasHistory: historicalData.length > 0,
  };
}

// ─── Prior year data loader ──────────────────────────────────────────────────

async function loadPriorYearData(
  venueId: string,
  db: admin.firestore.Firestore,
  eventDurationDays: number,
): Promise<PriorYearProduct[]> {

  // PRIORITY 1: Imported historical data (CSV/photo/manual via FestivalHistoricalDataScreen)
  try {
    const historicalSnap = await db
      .collection(`venues/${venueId}/event/details/historicalData`)
      .orderBy("year", "desc")
      .limit(3)
      .get();

    if (!historicalSnap.empty) {
      const allProducts: PriorYearProduct[] = [];
      historicalSnap.docs.forEach(docSnap => {
        const data = docSnap.data() as any;
        (data.products || []).forEach((p: any) => {
          allProducts.push({
            productName:      p.productName,
            totalUsed:        p.totalSold || 0,
            avgDailyVelocity: p.impliedDailyVelocity || 0,
            dataSource:       `${data.year}-import` as any,
            confidence:       "high",
          });
        });
      });
      if (allProducts.length > 0) return allProducts;
    }
  } catch {}

  // PRIORITY 2: Weekly snapshots + sales uploads (existing logic)
  const productVelocity: Record<string, PriorYearProduct> = {};

  // Weekly snapshots (soldTotals per product)
  try {
    const weeklySnaps = await db
      .collection(`venues/${venueId}/event/details/weeklySnapshots`)
      .limit(20)
      .get();
    weeklySnaps.docs.forEach(snap => {
      const data = snap.data() as any;
      Object.entries(data.soldTotals || {}).forEach(([productId, info]: [string, any]) => {
        const name = info.name || productId;
        if (!productVelocity[name]) {
          productVelocity[name] = { productName: name, totalUsed: 0, avgDailyVelocity: 0, dataSource: "weekly-snapshot", confidence: "medium" };
        }
        productVelocity[name].totalUsed += info.sold || 0;
      });
    });
  } catch {}

  // Sales data uploads (line items)
  try {
    const salesSnap = await db
      .collection(`venues/${venueId}/event/details/salesData`)
      .limit(20)
      .get();
    salesSnap.docs.forEach(upload => {
      const data = upload.data() as any;
      (data.lineItems || []).forEach((item: any) => {
        const name = item.productName || item.itemName;
        if (!name) return;
        if (!productVelocity[name]) {
          productVelocity[name] = { productName: name, totalUsed: 0, avgDailyVelocity: 0, dataSource: "sales-upload", confidence: "high" };
        }
        productVelocity[name].totalUsed += item.unitsSold || 0;
        productVelocity[name].dataSource  = "sales-upload";
        productVelocity[name].confidence  = "high";
      });
    });
  } catch {}

  const days = Math.max(1, eventDurationDays);
  Object.values(productVelocity).forEach(p => {
    p.avgDailyVelocity = Math.round(p.totalUsed / days);
  });

  return Object.values(productVelocity).filter(p => p.totalUsed > 0);
}

// ─── Obligations loader ──────────────────────────────────────────────────────

async function loadObligations(
  venueId: string,
  db: admin.firestore.Firestore,
): Promise<ObligationMin[]> {
  try {
    const snap = await db.collection(`venues/${venueId}/obligations`).limit(20).get();
    return snap.docs
      .map(d => d.data() as any)
      .filter(o => o.type === "minimum_volume" && o.supplierName && o.quantity)
      .map(o => ({ supplierName: o.supplierName, minimumQty: Number(o.quantity) }));
  } catch {
    return [];
  }
}

// ─── Prompt builder ──────────────────────────────────────────────────────────

export function buildRefinementPrompt(context: RefinementContext): string {
  const historySection = context.hasHistory
    ? `\nHISTORICAL DATA FROM PRIOR YEAR(S):\n` +
      context.historicalData.slice(0, 40).map(p =>
        `  ${p.productName}: ${p.totalUsed} total units used, ${p.avgDailyVelocity} units/day avg (${p.dataSource}, ${p.confidence} confidence)`
      ).join("\n") + "\n"
    : `\nNO HISTORICAL DATA AVAILABLE.\nThis is the first year for this event or no prior data exists. Use industry knowledge and event context. Be appropriately conservative and flag low confidence.\n`;

  const categoryLines = Object.entries(context.mathPrediction).map(([category, products]) => {
    const catTotal = products.reduce((s, p) => s + p.predictedQty, 0);
    const productLines = products.map(p => {
      const share = catTotal > 0 ? Math.round(p.predictedQty / catTotal * 100) : 0;
      return `    - ${p.productName}: ${p.predictedQty} units (${share}% equal split, supplier: ${p.supplierName})`;
    }).join("\n");
    return `  ${category.toUpperCase()} (category total: ${catTotal} units):\n${productLines}`;
  }).join("\n\n");

  const obligationsSection = context.obligations.length > 0
    ? "\nSPONSOR OBLIGATIONS:\n" + context.obligations.map(o =>
        `  ${o.supplierName}: minimum ${o.minimumQty} units`
      ).join("\n") + "\n"
    : "\nSPONSOR OBLIGATIONS: None on record\n";

  return `You are a beverage purchasing advisor specialising in NZ/AU festival operations.

Your task is to adjust MARKET SHARE SPLITS within beverage categories for a festival purchase order.

CRITICAL RULES:
- ONLY adjust market share splits within categories. NEVER change category totals.
- Market share percentages within each category MUST sum to exactly 1.0
- NEVER suggest pricing changes. NEVER recommend removing products.
- If uncertain — stay closer to equal split and flag low confidence.
- Products with historical data showing strong performance deserve higher share.

EVENT CONTEXT:
  Name: ${context.event.name}
  Type: ${context.event.type}
  Season: ${context.event.season} (NZ)
  Duration: ${context.event.durationDays} day${context.event.durationDays !== 1 ? "s" : ""}${context.event.isMultiDay ? " (multi-day)" : ""}
  Daily attendance: ${context.event.dailyAttendance.toLocaleString()}
  Price positioning: ${context.event.pricePositioning}
  Location: ${context.event.location || "NZ"}
${context.event.operatorNote ? `  Operator note: "${context.event.operatorNote}"\n` : ""}
MATH BASELINE (category totals are fixed — only adjust shares within categories):
${categoryLines}
${obligationsSection}
${historySection}
Respond with valid JSON only. No preamble. No explanation outside the JSON object.
{
  "adjustments": [
    {
      "productName": "exact product name as provided",
      "category": "beer|wine|spirits|rtd|na",
      "adjustedShare": 0.XX,
      "reasoning": "one sentence max",
      "confidenceInAdjustment": "high|medium|low"
    }
  ],
  "categoryNotes": {
    "beer": "one sentence or null",
    "wine": "one sentence or null",
    "spirits": "one sentence or null",
    "rtd": "one sentence or null",
    "na": "one sentence or null"
  },
  "overallConfidence": "high|medium|low",
  "historyUsed": ${context.hasHistory},
  "adjustmentNote": "one sentence summary of key adjustments made"
}

IMPORTANT: Shares within each category must sum to exactly 1.0. Single-product categories must have share 1.0.`;
}
