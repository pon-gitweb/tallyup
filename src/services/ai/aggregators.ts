// @ts-nocheck
/**
 * Lightweight, defensive “data-diet” builders for AI endpoints.
 * - No Firestore reads
 * - Works with current in-memory shapes
 * - Keeps payloads small and predictable
 */

// ---------- helpers ----------
const num = (v:any, d=0)=>{ const x=Number(v); return Number.isFinite(x) ? x : d; };
const m1  = (v:any)=>{ const x=Number(v); return Number.isFinite(x) ? Math.max(1, Math.round(x)) : 1; };
const s   = (v:any, d='') => typeof v === 'string' ? v : d;

// ---------- Suggested Orders aggregate ----------
/**
 * Build a minimal payload for AI Suggested Orders.
 *
 * @param args {
 *   venueId: string,
 *   historyDays?: number,        // default 14
 *   maxItems?: number,           // default 100
 *   products?: Array<{
 *     id: string,
 *     name?: string,
 *     par?: number,
 *     onHand?: number,
 *     supplierId?: string,
 *     supplierName?: string,
 *     packSize?: number,
 *     avgDailyUsage?: number,    // optional if you have it
 *   }>
 * }
 *
 * Returns { venueId, historyDays, candidates: [...] }
 * Each candidate: { productId, name, par, onHand, gap, supplierId?, supplierName?, packSize?, usagePerDay? }
 */
export function buildSuggestOrdersAggregate(args:{
  venueId: string,
  historyDays?: number,
  maxItems?: number,
  products?: any[],
}){
  const venueId = s(args?.venueId);
  const historyDays = Math.max(1, Math.round(num(args?.historyDays, 14)));
  const maxItems = Math.max(1, Math.round(num(args?.maxItems, 100)));
  const products = Array.isArray(args?.products) ? args.products : [];

  // Score by unmet PAR (gap desc), tie-breaker by usagePerDay desc
  const candidates = products.map(p=>{
    const productId   = s(p?.id);
    const name        = s(p?.name, productId);
    const par         = Math.max(0, Math.round(num(p?.par, 0)));
    const onHand      = Math.max(0, Math.round(num(p?.onHand, 0)));
    const gap         = Math.max(0, par - onHand);
    const supplierId  = s(p?.supplierId) || s(p?.supplier?.id);
    const supplierName= s(p?.supplierName) || s(p?.supplier?.name);
    const packSize    = Number.isFinite(p?.packSize) ? Number(p.packSize) : null;
    const usagePerDay = num(p?.avgDailyUsage, 0);

    return { productId, name, par, onHand, gap, supplierId, supplierName, packSize, usagePerDay };
  })
  .filter(c => c.productId)               // must have an id
  .filter(c => c.gap > 0 || c.usagePerDay > 0) // AI-worthy signal
  .sort((a,b)=>{
    if (b.gap !== a.gap) return b.gap - a.gap;
    return b.usagePerDay - a.usagePerDay;
  })
  .slice(0, maxItems);

  return { venueId, historyDays, candidates };
}

// ---------- Variance Explain aggregate ----------
/**
 * Build a minimal payload for AI Variance Explain.
 *
 * @param args {
 *   venueId: string,
 *   departmentId?: string|null,
 *   sinceDays?: number,            // default 14
 *   maxItems?: number,             // default 100
 *   items?: Array<{
 *     id: string,                  // productId or itemId
 *     name?: string,
 *     lastCountQty?: number,       // last stocktake qty
 *     movementQty?: number,        // sales/usage since last count (negative or positive)
 *     onHandNow?: number,          // current inferred on hand if you have it
 *     expectedNow?: number,        // expected on hand from model if you have it
 *     unitCost?: number,           // for value sorting
 *   }>
 * }
 *
 * Returns { venueId, departmentId, sinceDays, items:[...] }
 * Each item: { productId, name, lastCountQty, movementQty, onHandNow?, expectedNow?, variance?, value? }
 */
export function buildVarianceAggregate(args:{
  venueId: string,
  departmentId?: string|null,
  sinceDays?: number,
  maxItems?: number,
  items?: any[],
}){
  const venueId = s(args?.venueId);
  const departmentId = args?.departmentId ? s(args.departmentId) : null;
  const sinceDays = Math.max(1, Math.round(num(args?.sinceDays, 14)));
  const maxItems = Math.max(1, Math.round(num(args?.maxItems, 100)));
  const items = Array.isArray(args?.items) ? args.items : [];

  // Compute variance if not provided: variance = (onHandNow - expectedNow)
  const rows = items.map(it=>{
    const productId   = s(it?.id);
    const name        = s(it?.name, productId);
    const lastCountQty= num(it?.lastCountQty, 0);
    const movementQty = num(it?.movementQty, 0);
    const onHandNow   = Number.isFinite(it?.onHandNow) ? Number(it.onHandNow) : null;
    const expectedNow = Number.isFinite(it?.expectedNow) ? Number(it.expectedNow) : null;
    const unitCost    = num(it?.unitCost, 0);

    let variance = Number.isFinite(it?.variance) ? Number(it.variance) : null;
    if (variance == null && onHandNow != null && expectedNow != null) {
      variance = onHandNow - expectedNow;
    }

    const absVar = Math.abs(num(variance, 0));
    const value = absVar * unitCost;

    return { productId, name, lastCountQty, movementQty, onHandNow, expectedNow, variance, absVar, unitCost, value };
  })
  .filter(r => r.productId)                       // must have an id
  .filter(r => r.absVar > 0 || Math.abs(r.movementQty) > 0) // only AI-worthy deltas
  .sort((a,b)=>{
    // prioritize by value, then absolute variance, then movement magnitude
    if (b.value !== a.value) return b.value - a.value;
    if (b.absVar !== a.absVar) return b.absVar - a.absVar;
    return Math.abs(b.movementQty) - Math.abs(a.movementQty);
  })
  .slice(0, maxItems)
  .map(r=>({
    productId: r.productId,
    name: r.name,
    lastCountQty: r.lastCountQty,
    movementQty: r.movementQty,
    onHandNow: r.onHandNow,
    expectedNow: r.expectedNow,
    variance: r.variance,
    value: r.value,
  }));

  return { venueId, departmentId, sinceDays, items: rows };
}
