// @ts-nocheck
/**
 * Client-fed AI suggester (variance-style).
 * - Reads suppliers & products from Firestore (web SDK).
 * - Builds light aggregate signals.
 * - Filters to AI-worthy candidates.
 * - Calls /api/suggest-ai and normalizes { buckets, unassigned }.
 * - Logs a tiny summary to Firestore (no Admin SDK).
 */

import {
  getFirestore, collection, getDocs, doc, setDoc, addDoc, serverTimestamp,
} from 'firebase/firestore';

import { AI_SUGGEST_URL } from '../../config/ai'; // keep your existing config
import { filterAICandidates, buildAISuggestRequestBody } from './aiPayload';

// small utils
const n = (v: any, d = 0) => { const x = Number(v); return Number.isFinite(x) ? x : d; };
const s = (v: any, d = '') => (typeof v === 'string' ? v : d);
const NO_SUPPLIER_KEYS = new Set(['unassigned','__no_supplier__','no_supplier','none','null','undefined','']);

// FNV-1a hash for small request body fingerprint (no crypto deps)
function hashFNV1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  // 8-hex digest
  return ('00000000' + (h >>> 0).toString(16)).slice(-8);
}

function dedupeByProductId(lines: any[]): any[] {
  const seen = new Set<string>();
  const out: any[] = [];
  for (const l of Array.isArray(lines) ? lines : []) {
    const pid = String(l?.productId ?? '');
    if (!pid || seen.has(pid)) continue;
    seen.add(pid);
    out.push(l);
  }
  return out;
}

function normalizeResult(raw: any){
  const buckets = (raw && raw.buckets && typeof raw.buckets === 'object') ? raw.buckets : {};
  const unBase = Array.isArray(raw?.unassigned?.lines) ? raw.unassigned.lines : [];
  const unPool = [...unBase];

  // Merge "no supplier" keys into unassigned
  Object.keys(buckets).forEach(k=>{
    if (NO_SUPPLIER_KEYS.has(String(k))) {
      const ls = Array.isArray(buckets[k]?.lines) ? buckets[k].lines : [];
      if (ls.length) unPool.push(...ls);
      delete buckets[k];
    }
  });

  // Ensure per-bucket de-dup
  Object.keys(buckets).forEach(k=>{
    const arr = Array.isArray(buckets[k]?.lines) ? buckets[k].lines : [];
    buckets[k].lines = dedupeByProductId(arr);
  });

  return { buckets, unassigned: { lines: dedupeByProductId(unPool) } };
}

// ---- Public API ------------------------------------------------------------

/**
 * Run AI suggester:
 *  - reads suppliers & products (light fields)
 *  - builds aggregates
 *  - filters/caps to AI-worthy candidates
 *  - POSTs to AI server
 *  - logs tiny summary doc
 */
export async function runAISuggest(venueId: string, opts?: { historyDays?: number; k?: number; max?: number }){
  const db = getFirestore();

  // 1) Load suppliers (id, name)
  const suppliersSnap = await getDocs(collection(db,'venues',venueId,'suppliers'));
  const suppliers = suppliersSnap.docs.map(d=>({
    id: d.id,
    name: s(d.data()?.name, 'Supplier'),
  }));

  // 2) Load products (light fields). We only read what we need.
  const productsSnap = await getDocs(collection(db,'venues',venueId,'products'));
  const productsAgg = productsSnap.docs.map(d=>{
    const p:any = d.data() || {};
    return {
      id: d.id,
      name: s(p?.name, d.id),
      supplierId: p?.supplierId || p?.supplier?.id || null,
      supplierName: p?.supplierName || p?.supplier?.name || null,
      par: Number.isFinite(p?.par) ? Number(p.par) : null,
      unitCost: Number.isFinite(p?.unitCost) ? Number(p.unitCost) : null,
      packSize: Number.isFinite(p?.packSize) ? Number(p.packSize) : null,

      // Optional usage / stock snapshot (include if present on product docs)
      avgDailyUsage_30: Number.isFinite(p?.avgDailyUsage_30) ? Number(p.avgDailyUsage_30) : null,
      avgDailyUsage_90: Number.isFinite(p?.avgDailyUsage_90) ? Number(p.avgDailyUsage_90) : null,
      avgDailyUsage_180: Number.isFinite(p?.avgDailyUsage_180) ? Number(p.avgDailyUsage_180) : null,
      avgDailyUsage_270: Number.isFinite(p?.avgDailyUsage_270) ? Number(p.avgDailyUsage_270) : null,

      onHand: Number.isFinite(p?.onHand) ? Number(p.onHand) : null,
      daysSinceLastCount: Number.isFinite(p?.daysSinceLastCount) ? Number(p.daysSinceLastCount) : null,
    };
  });

  // 3) Filter/cap candidates
  const candidates = filterAICandidates(productsAgg, { k: opts?.k ?? 3, max: opts?.max ?? 400 });

  // 4) Build request body (variance-style)
  const body = buildAISuggestRequestBody({
    venueId,
    suppliers,
    products: candidates,
    historyDays: opts?.historyDays ?? 28,
  });

  // 5) POST to AI server
  let respJson:any = null;
  try{
    const resp = await fetch(AI_SUGGEST_URL, {
      method:'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify(body),
    });
    respJson = await resp.json();
  }catch(e:any){
    // Surface a controlled error; the UI can show a toast
    throw new Error(e?.message || 'Could not reach AI server');
  }

  const normalized = normalizeResult(respJson || {});

  // 6) Tiny log (no Admin SDK) → venues/{venueId}/aiSuggestions/{autoId}
  try{
    const summary = {
      createdAt: serverTimestamp(),
      requestHash: hashFNV1a(JSON.stringify({
        v: 1,
        venueId: body.venueId,
        historyDays: body.historyDays,
        suppliersLen: body.suppliers?.length || 0,
        productsLen: body.products?.length || 0,
      })),
      suppliersLen: body.suppliers?.length || 0,
      productsLen: body.products?.length || 0,
      out_suppliers: Object.keys(normalized.buckets || {}).length,
      out_unassigned: Array.isArray(normalized?.unassigned?.lines) ? normalized.unassigned.lines.length : 0,
      // Optional: keep an at-a-glance supplier counts (bounded)
      out_supplierCounts: Object.fromEntries(
        Object.entries(normalized?.buckets || {}).slice(0, 25).map(([k,v]:any)=>[k, Array.isArray(v?.lines)? v.lines.length : 0])
      ),
    };
    await addDoc(collection(db,'venues',venueId,'aiSuggestions'), summary);
  }catch(_){ /* non-fatal */ }

  return normalized;
}
