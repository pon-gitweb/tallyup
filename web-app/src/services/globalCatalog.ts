// Mirrors src/services/globalCatalog.ts (mobile) — separate build targets,
// faithful port of CatalogHit type and read logic.
// tokenizeForMatching/overlapCoefficient/isReliableMatch port functions/src/nameMatching.ts.
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

function tokenizeForMatching(s: string): Set<string> {
  const normalised = (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  const words = normalised.split(' ').filter(Boolean)
  const tokens: string[] = []
  for (const word of words) {
    const m = word.match(/^([a-z]+)(\d+)$/)
    if (m) {
      tokens.push(m[1], m[2])
    } else {
      tokens.push(word)
    }
  }
  return new Set(tokens.map(t => (/^\d{2}$/.test(t) ? '20' + t : t)))
}

function overlapCoefficient(a: string, b: string): number {
  const ta = tokenizeForMatching(a)
  const tb = tokenizeForMatching(b)
  if (ta.size === 0 && tb.size === 0) return 1
  if (ta.size === 0 || tb.size === 0) return 0
  let intersection = 0
  ta.forEach(t => { if (tb.has(t)) intersection++ })
  return intersection / Math.min(ta.size, tb.size)
}

function isReliableMatch(tokensA: Set<string>, tokensB: Set<string>, score: number): boolean {
  if (score < 0.85) return false
  const minSize = Math.min(tokensA.size, tokensB.size)
  if (minSize >= 2) return true
  if (minSize === 0) return false
  const sharedToken = [...tokensA].find(t => tokensB.has(t))
  return sharedToken !== undefined && sharedToken.length >= 6
}

const num = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : null }
const clean = (s: any) => typeof s === 'string' ? s.trim() : ''

// Fuzzy search across all suppliers' items using overlap coefficient matching.
// Per-supplier item cap of 200 (vs the prefix search's 25) because fuzzy
// matching requires seeing the full item list rather than a narrowed prefix window.
// Returns all reliable matches sorted by score descending.
export async function searchGlobalCatalogFuzzy(
  productName: string,
): Promise<(CatalogHit & { score: number })[]> {
  const t = productName.trim()
  if (!t) return []

  const suppliers = await getDocs(collection(db, 'global_suppliers'))
  if (suppliers.empty) return []

  const results: (CatalogHit & { score: number })[] = []

  const ta = tokenizeForMatching(t)

  for (const sup of suppliers.docs) {
    const supplierGlobalId = sup.id
    const supplierName = (sup.data() as any)?.name || supplierGlobalId

    const itemsSnap = await getDocs(
      query(collection(db, 'global_suppliers', supplierGlobalId, 'items'), limit(200))
    )
    itemsSnap.forEach(d => {
      const v: any = d.data() || {}
      const name = v.name || ''
      const tb = tokenizeForMatching(name)
      const score = overlapCoefficient(t, name)
      if (isReliableMatch(ta, tb, score)) {
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
