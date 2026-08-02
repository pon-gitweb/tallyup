// Mirrors src/services/globalCatalog.ts (mobile) — separate build targets,
// faithful port of CatalogHit type and read logic.
// normNameInline/tokenJaccardInline mirror functions/src/ocrInvoicePhoto.ts:544-556.
// If you change the matching logic, update both files.
import { db } from '../firebase'
import { collection, getDocs, limit, query } from 'firebase/firestore'

export type CatalogHit = {
  supplierGlobalId: string
  supplierName: string
  externalSku?: string | null
  name: string
  size?: string | null
  abv?: number | null
  unit?: string | null
  unitsPerCase?: number | null
  priceBottleExGst?: number | null
  priceCaseExGst?: number | null
  gstPercent?: number | null
  category?: string | null
  notes?: string | null
}

function normNameInline(s: string): string {
  return (s || '').toLowerCase().trim().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ')
}

function tokenJaccardInline(a: string, b: string): number {
  const ta = new Set(normNameInline(a).split(' ').filter(Boolean))
  const tb = new Set(normNameInline(b).split(' ').filter(Boolean))
  if (ta.size === 0 && tb.size === 0) return 1
  if (ta.size === 0 || tb.size === 0) return 0
  let intersection = 0
  ta.forEach(t => { if (tb.has(t)) intersection++ })
  return intersection / (ta.size + tb.size - intersection)
}

const num = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : null }
const clean = (s: any) => typeof s === 'string' ? s.trim() : ''

// Fuzzy search across all suppliers' items using token Jaccard similarity.
// Per-supplier item cap of 200 (vs the prefix search's 25) because fuzzy
// matching requires seeing the full item list rather than a narrowed prefix window.
// Returns all matches above threshold, sorted by score descending.
export async function searchGlobalCatalogFuzzy(
  productName: string,
  threshold = 0.85,
): Promise<(CatalogHit & { score: number })[]> {
  const t = productName.trim()
  if (!t) return []

  const suppliers = await getDocs(collection(db, 'global_suppliers'))
  if (suppliers.empty) return []

  const results: (CatalogHit & { score: number })[] = []

  for (const sup of suppliers.docs) {
    const supplierGlobalId = sup.id
    const supplierName = (sup.data() as any)?.name || supplierGlobalId

    const itemsSnap = await getDocs(
      query(collection(db, 'global_suppliers', supplierGlobalId, 'items'), limit(200))
    )
    itemsSnap.forEach(d => {
      const v: any = d.data() || {}
      const score = tokenJaccardInline(t, v.name || '')
      if (score >= threshold) {
        results.push({
          supplierGlobalId,
          supplierName,
          externalSku: clean(v.externalSku || ''),
          name: clean(v.name || ''),
          size: clean(v.size || ''),
          abv: num(v.abv),
          unit: clean(v.unit || ''),
          unitsPerCase: num(v.unitsPerCase),
          priceBottleExGst: num(v.priceBottleExGst),
          priceCaseExGst: num(v.priceCaseExGst),
          gstPercent: num(v.gstPercent),
          category: clean(v.category || ''),
          notes: clean(v.notes || ''),
          score,
        })
      }
    })
  }

  results.sort((a, b) => b.score - a.score)
  return results
}
