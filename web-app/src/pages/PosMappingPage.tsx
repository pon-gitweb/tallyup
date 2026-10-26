import { useEffect, useMemo, useState } from 'react'
import {
  collection, doc, getDocs, getDoc, query,
  serverTimestamp, where, writeBatch, deleteDoc,
} from 'firebase/firestore'
import { auth, db } from '../firebase'
import {
  partitionReports, buildUnmatchedRows, matchDocToMatchData,
  normName as wlNormName,
  type ActiveReport, type MatchData, type UnmatchedRow,
} from '../utils/weeklyLedger'
import { mappingDocId } from '../utils/mappingId'
import { parseProductSize } from '../utils/productSize'
import { stripUndefinedDeep } from '../utils/stripUndefinedDeep'
import styles from './PosMappingPage.module.css'

// ── Types ─────────────────────────────────────────────────────────────────────

type Product = {
  id: string
  name: string
  size?: string | null
  unit?: string | null
  mergedInto?: string | null
  category?: string | null
}
type Recipe  = { id: string; name: string }
type Mapping = {
  id: string
  posItemName: string
  posSystem: string
  mappingType: string
  productId?: string | null
  productName?: string | null
  recipeId?: string | null
  recipeName?: string | null
  servingMl?: number | null
  conversionRatio?: number | null
  servingType?: string | null
  conversionUnit?: string | null
  createdAt?: unknown
}

export type NoServingRow = {
  posName: string
  normalisedName: string
  productId: string
  productName: string
  totalQty: number
  reportIds: string[]
}

export type AllMappingRow = {
  mapping: Mapping
  targetLabel: string
  servingLabel: string
  ratio: number | null
  seenInReports: number
  totalQtySold: number
  warningMergedOrMissing: boolean
  warningNoServing: boolean
}

type TabKey = 'not-linked' | 'no-serving' | 'all-mappings'

// ── Serving presets ───────────────────────────────────────────────────────────

const SERVING_PRESETS = [
  { label: 'Each (1:1)', type: 'each',       ml: null  },
  { label: 'Shot 30ml',  type: 'shot',        ml: 30    },
  { label: 'Wine 150ml', type: 'wine_glass',  ml: 150   },
  { label: 'Schooner',   type: 'schooner',    ml: 425   },
  { label: 'Pint',       type: 'pint',        ml: 568   },
  { label: 'Half pint',  type: 'half_pint',   ml: 284   },
  { label: 'Custom ml',  type: 'custom',      ml: null  },
]

function productSizeInMl(p: Product): number | null {
  if (!p.size) return null
  const parsed = parseProductSize(p.size, p.unit)
  if (!parsed || parsed.base !== 'ml') return null
  return parsed.amount
}

// ── Pure exports (used by tests) ──────────────────────────────────────────────

export function buildNotLinkedRows(
  rows: UnmatchedRow[],
  mappingsByLower: Record<string, { mappingType: string }>,
): UnmatchedRow[] {
  return rows.filter(r => !mappingsByLower[(r.origName || '').toLowerCase()])
}

type MappingIndex = Record<string, { mappingType: string; servingMl?: number | null; conversionRatio?: number | null }>

function hasFiniteSize(mp: { servingMl?: number | null; conversionRatio?: number | null }): boolean {
  return (mp.servingMl != null && isFinite(mp.servingMl) && mp.servingMl > 0)
    || (mp.conversionRatio != null && isFinite(mp.conversionRatio) && mp.conversionRatio > 0)
}

export function buildNoServingRows(
  activeReports: ActiveReport[],
  matchesByReport: Record<string, MatchData | null>,
  mappingsByLower: MappingIndex = {},
): NoServingRow[] {
  const byNorm = new Map<string, NoServingRow>()
  for (const r of activeReports) {
    const md = matchesByReport[r.id]
    if (!md) continue
    for (const m of md.matches) {
      const src = m.conversionSource
      if (src === 'servingMl' || src === 'conversionRatio' || src === 'each') continue
      if (src !== 'default' && src != null) continue
      if (src == null) {
        const key = (m.name ?? '').toLowerCase()
        const mp = mappingsByLower[key]
        if (mp) {
          if (mp.mappingType === 'recipe' || mp.mappingType === 'skipped') continue
          if (hasFiniteSize(mp)) continue
        }
      }
      const name = (m.name ?? m.productName ?? '').trim()
      if (!name || !m.productId) continue
      const nn = wlNormName(name)
      if (!byNorm.has(nn)) {
        byNorm.set(nn, { posName: name, normalisedName: nn, productId: m.productId!, productName: m.productName ?? '', totalQty: 0, reportIds: [] })
      }
      const row = byNorm.get(nn)!
      row.totalQty += m.qtySold ?? 0
      if (!row.reportIds.includes(r.id)) row.reportIds.push(r.id)
    }
  }
  return [...byNorm.values()].sort((a, b) => b.totalQty - a.totalQty)
}

export function servingPreviewText(servingMl: number, productSizeMl: number): string {
  if (servingMl <= 0 || productSizeMl <= 0) return ''
  const ratio = servingMl / productSizeMl
  const ratioStr = ratio < 0.01 ? ratio.toFixed(4) : ratio.toFixed(3).replace(/\.?0+$/, '')
  return `1 sale = ${ratioStr} stock units (${servingMl}ml of ${productSizeMl}ml bottle)`
}

export function buildSavePayload(
  posItemName: string,
  posSystem: string,
  mappingType: 'direct_product' | 'recipe' | 'skipped',
  opts: {
    productId?: string | null
    productName?: string | null
    recipeId?: string | null
    recipeName?: string | null
    servingMl?: number | null
    conversionRatio?: number | null
    servingType?: string | null
    conversionUnit?: string | null
  },
): Record<string, unknown> {
  return stripUndefinedDeep({
    posItemName,
    posSystem,
    mappingType,
    productId:       opts.productId       ?? null,
    productName:     opts.productName     ?? null,
    recipeId:        opts.recipeId        ?? null,
    recipeName:      opts.recipeName      ?? null,
    servingMl:       opts.servingMl       ?? null,
    conversionRatio: opts.conversionRatio ?? null,
    servingType:     opts.servingType     ?? null,
    conversionUnit:  opts.conversionUnit  ?? null,
  })
}

export function computeServingFields(
  preset: string,
  customMl: string,
  sizeMl: number | null,
): { servingMl: number | null; conversionRatio: number | null; servingType: string; conversionUnit: string } | { skip: string } {
  if (preset === 'each') {
    return { servingMl: null, conversionRatio: null, servingType: 'each', conversionUnit: 'each' }
  }
  if (preset === 'full_bottle') {
    if (sizeMl == null) return { skip: 'full_bottle with unknown size' }
    return { servingMl: sizeMl, conversionRatio: 1, servingType: 'full_bottle', conversionUnit: 'ml' }
  }
  const presetDef = SERVING_PRESETS.find(p => p.type === preset)
  let ml: number | null = presetDef?.ml ?? null
  if (preset === 'custom') {
    const v = parseFloat(customMl)
    ml = isNaN(v) || v <= 0 ? null : v
  }
  const conversionRatio = ml != null && sizeMl != null ? ml / sizeMl : null
  return { servingMl: ml, conversionRatio, servingType: preset, conversionUnit: 'ml' }
}

export function buildEditPayload(
  existing: Pick<Mapping, 'posItemName' | 'posSystem'> & { createdAt?: unknown },
  changes: {
    mode: 'product' | 'recipe' | 'skip'
    product?: Product | null
    recipe?: Recipe | null
    servingPreset?: string
    customMl?: string
  },
): { payload: Record<string, unknown>; createdAt: unknown } {
  const posItemName = existing.posItemName
  const posSystem = existing.posSystem ?? 'csv'
  const createdAt = (existing as any).createdAt ?? null

  if (changes.mode === 'skip') {
    return { payload: buildSavePayload(posItemName, posSystem, 'skipped', {}), createdAt }
  }
  if (changes.mode === 'recipe') {
    const r = changes.recipe ?? null
    return {
      payload: buildSavePayload(posItemName, posSystem, 'recipe', {
        recipeId: r?.id ?? null,
        recipeName: r?.name ?? null,
      }),
      createdAt,
    }
  }
  const p = changes.product ?? null
  if (!p) {
    return { payload: buildSavePayload(posItemName, posSystem, 'direct_product', {}), createdAt }
  }
  const sizeMl = productSizeInMl(p)
  const preset = changes.servingPreset ?? 'each'
  const customMlStr = changes.customMl ?? ''
  const serving = computeServingFields(preset, customMlStr, sizeMl)
  if ('skip' in serving) {
    return {
      payload: buildSavePayload(posItemName, posSystem, 'direct_product', {
        productId: p.id,
        productName: p.name,
      }),
      createdAt,
    }
  }
  return {
    payload: buildSavePayload(posItemName, posSystem, 'direct_product', {
      productId: p.id,
      productName: p.name,
      servingMl: serving.servingMl,
      conversionRatio: serving.conversionRatio,
      servingType: serving.servingType,
      conversionUnit: serving.conversionUnit,
    }),
    createdAt,
  }
}

export function buildBulkServingPayloads(
  selectedRows: NoServingRow[],
  products: Product[],
  servingPreset: string,
  customMl: string,
): Array<{ posName: string; docId: string; payload: Record<string, unknown> } | { posName: string; docId: string; skip: string }> {
  return selectedRows.map(row => {
    const dId = mappingDocId(row.posName, 'csv')
    const product = products.find(p => p.id === row.productId)
    if (!product) return { posName: row.posName, docId: dId, skip: 'product not found' }
    const sizeMl = productSizeInMl(product)
    const serving = computeServingFields(servingPreset, customMl, sizeMl)
    if ('skip' in serving) return { posName: row.posName, docId: dId, skip: serving.skip }
    return {
      posName: row.posName,
      docId: dId,
      payload: buildSavePayload(row.posName, 'csv', 'direct_product', {
        productId: product.id,
        productName: product.name,
        servingMl: serving.servingMl,
        conversionRatio: serving.conversionRatio,
        servingType: serving.servingType,
        conversionUnit: serving.conversionUnit,
      }),
    }
  })
}

export function buildBulkIgnorePayloads(
  posNames: string[],
): Array<{ posName: string; docId: string; payload: Record<string, unknown> }> {
  return posNames.map(posName => ({
    posName,
    docId: mappingDocId(posName, 'csv'),
    payload: buildSavePayload(posName, 'csv', 'skipped', {}),
  }))
}

export function unionReportIds(
  names: string[],
  activeReports: ActiveReport[],
): string[] {
  const normNames = new Set(names.map(n => wlNormName(n)))
  const ids = new Set<string>()
  for (const r of activeReports) {
    for (const l of r.rawLines) {
      if (normNames.has(wlNormName(l.name ?? ''))) {
        ids.add(r.id)
        break
      }
    }
  }
  return [...ids]
}

export function allMappingsRows(
  mappings: Mapping[],
  products: Product[],
  recipes: Recipe[],
  activeReports: ActiveReport[],
  matchesByReport: Record<string, MatchData | null>,
): AllMappingRow[] {
  const productById = new Map(products.map(p => [p.id, p]))
  const recipeById  = new Map(recipes.map(r => [r.id, r]))

  return mappings.map(m => {
    let targetLabel = '—'
    let warningMergedOrMissing = false

    if (m.mappingType === 'direct_product') {
      if (!m.productId) {
        targetLabel = '(missing product)'; warningMergedOrMissing = true
      } else {
        const p = productById.get(m.productId)
        if (!p) {
          targetLabel = '(missing product)'; warningMergedOrMissing = true
        } else if (p.mergedInto) {
          const survivor = productById.get(p.mergedInto)
          targetLabel = survivor
            ? `${p.name} → merged into ${survivor.name}`
            : `${p.name} → merged into (missing)`
          warningMergedOrMissing = true
        } else {
          targetLabel = p.name
        }
      }
    } else if (m.mappingType === 'recipe') {
      if (!m.recipeId) {
        targetLabel = '(missing recipe)'; warningMergedOrMissing = true
      } else {
        const r = recipeById.get(m.recipeId)
        if (r) { targetLabel = r.name }
        else { targetLabel = '(missing recipe)'; warningMergedOrMissing = true }
      }
    } else if (m.mappingType === 'skipped') {
      targetLabel = 'Ignored'
    }

    let servingLabel = '—'
    if (m.mappingType === 'direct_product') {
      if (m.servingType === 'each' || m.conversionUnit === 'each') {
        servingLabel = 'Each'
      } else if (m.servingType) {
        const preset = SERVING_PRESETS.find(p => p.type === m.servingType)
        servingLabel = preset ? preset.label : m.servingMl ? `${m.servingMl}ml` : '—'
      } else if (m.servingMl) {
        servingLabel = `${m.servingMl}ml`
      }
    }

    const warningNoServing = m.mappingType === 'direct_product'
      && !warningMergedOrMissing
      && m.servingType !== 'each'
      && m.conversionUnit !== 'each'
      && !(m.servingMl != null && m.servingMl > 0)
      && !(m.conversionRatio != null && m.conversionRatio > 0)

    const norm = wlNormName(m.posItemName ?? '')
    let seenInReports = 0
    let totalQtySold = 0
    for (const r of activeReports) {
      const inLines = r.rawLines.some(l => wlNormName(l.name ?? '') === norm)
      if (inLines) {
        seenInReports++
        const md = matchesByReport[r.id]
        if (md) {
          for (const match of md.matches) {
            if (wlNormName(match.name ?? '') === norm) totalQtySold += match.qtySold ?? 0
          }
        }
      }
    }

    return { mapping: m, targetLabel, servingLabel, ratio: m.conversionRatio ?? null, seenInReports, totalQtySold, warningMergedOrMissing, warningNoServing }
  })
}

export function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size))
  return chunks
}

export async function rematchReports(
  venueId: string,
  reportIds: string[],
  token: string,
  onProgress: (done: number, total: number) => void,
): Promise<{ errors: string[] }> {
  const errors: string[] = []
  for (let i = 0; i < reportIds.length; i++) {
    try {
      const res = await fetch(
        'https://us-central1-tallyup-f1463.cloudfunctions.net/api/match-sales-report',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ venueId, reportId: reportIds[i] }),
        },
      )
      if (!res.ok) errors.push(`Report ${reportIds[i]}: HTTP ${res.status}`)
    } catch (e: any) {
      errors.push(`Report ${reportIds[i]}: ${e?.message ?? 'network error'}`)
    }
    onProgress(i + 1, reportIds.length)
  }
  return { errors }
}

// ── Mapping panel ─────────────────────────────────────────────────────────────

function initPanelState(
  existingMapping: Mapping | null,
  products: Product[],
  recipes: Recipe[],
) {
  if (!existingMapping) {
    return { mode: 'product' as const, selectedProduct: null as Product | null, servingPreset: 'each', customMl: '', selectedRecipe: null as Recipe | null }
  }
  if (existingMapping.mappingType === 'skipped') {
    return { mode: 'skip' as const, selectedProduct: null as Product | null, servingPreset: 'each', customMl: '', selectedRecipe: null as Recipe | null }
  }
  if (existingMapping.mappingType === 'recipe') {
    const recipe = recipes.find(r => r.id === existingMapping.recipeId) ?? null
    return { mode: 'recipe' as const, selectedProduct: null as Product | null, servingPreset: 'each', customMl: '', selectedRecipe: recipe }
  }
  const product = products.find(p => p.id === existingMapping.productId) ?? null
  let servingPreset = 'each'
  let customMl = ''
  if (existingMapping.servingType) {
    servingPreset = existingMapping.servingType
    if (existingMapping.servingType === 'custom') customMl = String(existingMapping.servingMl ?? '')
  } else if (existingMapping.conversionUnit === 'each') {
    servingPreset = 'each'
  } else if (existingMapping.servingMl && existingMapping.servingMl > 0) {
    servingPreset = 'custom'
    customMl = String(existingMapping.servingMl)
  }
  return { mode: 'product' as const, selectedProduct: product, servingPreset, customMl, selectedRecipe: null as Recipe | null }
}

function MappingPanel({
  posName,
  preselectedProduct,
  existingMapping,
  affectedReports,
  products,
  recipes,
  saving,
  onSave,
  onClose,
  onUnlink,
}: {
  posName: string
  preselectedProduct?: { id: string; name: string } | null
  existingMapping?: Mapping | null
  affectedReports?: { count: number; dateRange: string | null } | null
  products: Product[]
  recipes: Recipe[]
  saving: boolean
  onSave: (payload: Record<string, unknown>, posName: string, existingCreatedAt?: unknown) => void
  onClose: () => void
  onUnlink?: () => void
}) {
  const init = initPanelState(existingMapping ?? null, products, recipes)
  const [mode, setMode]               = useState<'product' | 'recipe' | 'skip'>(
    preselectedProduct && !existingMapping ? 'product' : init.mode
  )
  const [productSearch, setProductSearch] = useState('')
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(
    existingMapping ? init.selectedProduct
      : preselectedProduct ? products.find(p => p.id === preselectedProduct.id) ?? null
      : null
  )
  const [servingPreset, setServingPreset] = useState<string>(init.servingPreset)
  const [customMl, setCustomMl]       = useState(init.customMl)
  const [recipeSearch, setRecipeSearch] = useState('')
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(init.selectedRecipe)
  const [unlinkConfirm, setUnlinkConfirm] = useState(false)

  const filteredProducts = useMemo(() => {
    const q = productSearch.toLowerCase()
    return q ? products.filter(p => p.name.toLowerCase().includes(q)).slice(0, 12) : []
  }, [products, productSearch])

  const filteredRecipes = useMemo(() => {
    const q = recipeSearch.toLowerCase()
    return q ? recipes.filter(r => r.name.toLowerCase().includes(q)).slice(0, 12) : []
  }, [recipes, recipeSearch])

  const sizeMl = selectedProduct ? productSizeInMl(selectedProduct) : null
  const servingMl: number | null = useMemo(() => {
    if (servingPreset === 'each' || mode !== 'product' || !selectedProduct) return null
    if (servingPreset === 'full_bottle') return sizeMl
    const preset = SERVING_PRESETS.find(p => p.type === servingPreset)
    if (preset?.ml != null) return preset.ml
    if (servingPreset === 'custom') {
      const v = parseFloat(customMl)
      return isNaN(v) || v <= 0 ? null : v
    }
    return null
  }, [servingPreset, sizeMl, customMl, mode, selectedProduct])

  const previewText = useMemo(() => {
    if (mode !== 'product' || !selectedProduct) return null
    if (servingPreset === 'each') return '1 sale = 1 stock unit (each)'
    if (servingMl == null) return null
    if (sizeMl == null) return `1 sale uses ${servingMl}ml (product size unknown — ratio will use legacy conversion)`
    return servingPreviewText(servingMl, sizeMl)
  }, [mode, selectedProduct, servingPreset, servingMl, sizeMl])

  function handleSave() {
    if (existingMapping) {
      const { payload, createdAt } = buildEditPayload(existingMapping, {
        mode, product: selectedProduct, recipe: selectedRecipe, servingPreset, customMl,
      })
      onSave(payload, posName, createdAt)
      return
    }
    if (mode === 'skip') {
      onSave(buildSavePayload(posName, 'csv', 'skipped', {}), posName)
      return
    }
    if (mode === 'recipe') {
      if (!selectedRecipe) return
      onSave(buildSavePayload(posName, 'csv', 'recipe', { recipeId: selectedRecipe.id, recipeName: selectedRecipe.name }), posName)
      return
    }
    if (!selectedProduct) return
    const szMl = productSizeInMl(selectedProduct)
    const serving = computeServingFields(servingPreset, customMl, szMl)
    if ('skip' in serving) return
    onSave(buildSavePayload(posName, 'csv', 'direct_product', {
      productId:       selectedProduct.id,
      productName:     selectedProduct.name,
      servingMl:       serving.servingMl,
      conversionRatio: serving.conversionRatio,
      servingType:     serving.servingType,
      conversionUnit:  serving.conversionUnit,
    }), posName)
  }

  const canSave = mode === 'skip'
    || (mode === 'recipe' && !!selectedRecipe)
    || (mode === 'product' && !!selectedProduct && (servingPreset === 'each' || servingMl != null))

  return (
    <div className={styles.drawerOverlay} onClick={() => { if (!saving) onClose() }}>
      <div className={styles.drawer} onClick={e => e.stopPropagation()}>
        <div>
          <button className={styles.drawerClose} onClick={() => { if (!saving) onClose() }}>×</button>
          <p className={styles.drawerTitle}>{posName}</p>
          <p className={styles.drawerSubtitle}>
            {existingMapping ? 'Edit this POS mapping' : 'Set how this POS name maps to your catalogue'}
          </p>
        </div>

        {affectedReports && affectedReports.count > 0 && (
          <div className={`${styles.banner} ${styles.bannerAmber}`}>
            This will re-match {affectedReports.count} report{affectedReports.count !== 1 ? 's' : ''}
            {affectedReports.dateRange ? ` (${affectedReports.dateRange})` : ''}.
            Past sales for this button will move to the new product.
          </div>
        )}

        <div style={{ display: 'flex', gap: 6 }}>
          {(['product', 'recipe', 'skip'] as const).map(m => (
            <button
              key={m}
              className={`${styles.btnSmall} ${mode === m ? styles.btnPrimary : styles.btnOutline}`}
              onClick={() => setMode(m)}
            >
              {m === 'product' ? 'Product' : m === 'recipe' ? 'Recipe' : 'Ignore'}
            </button>
          ))}
        </div>

        {mode === 'product' && (
          <>
            <div className={styles.drawerSection}>
              <p className={styles.drawerSectionTitle}>Product</p>
              {selectedProduct
                ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                    <span style={{ flex: 1, fontWeight: 600, color: '#1a2332' }}>{selectedProduct.name}</span>
                    <button className={`${styles.btnSmall} ${styles.btnOutline}`} onClick={() => { setSelectedProduct(null); setProductSearch('') }}>Change</button>
                  </div>
                )
                : (
                  <>
                    <input
                      className={styles.searchInput}
                      placeholder="Search products…"
                      value={productSearch}
                      onChange={e => setProductSearch(e.target.value)}
                      autoFocus
                    />
                    {filteredProducts.length > 0 && (
                      <div className={styles.searchResults}>
                        {filteredProducts.map(p => (
                          <div
                            key={p.id}
                            className={styles.searchResultItem}
                            onClick={() => { setSelectedProduct(p); setProductSearch('') }}
                          >
                            {p.name}
                            {p.size && p.unit && <span style={{ color: '#9ca3af', fontSize: 11, marginLeft: 6 }}>{p.size}{p.unit}</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )
              }
            </div>

            {selectedProduct && (
              <div className={styles.drawerSection}>
                <p className={styles.drawerSectionTitle}>Serving size</p>
                <div className={styles.servingTypeTabs}>
                  {SERVING_PRESETS.map(p => (
                    <button
                      key={p.type}
                      className={`${styles.servingTypeBtn} ${servingPreset === p.type ? styles.servingTypeBtnActive : ''}`}
                      onClick={() => setServingPreset(p.type)}
                    >
                      {p.label}
                    </button>
                  ))}
                  {sizeMl != null && (
                    <button
                      className={`${styles.servingTypeBtn} ${servingPreset === 'full_bottle' ? styles.servingTypeBtnActive : ''}`}
                      onClick={() => setServingPreset('full_bottle')}
                    >
                      Full bottle ({sizeMl}ml)
                    </button>
                  )}
                </div>
                {servingPreset === 'custom' && (
                  <input
                    className={styles.searchInput}
                    style={{ marginTop: 8, width: 120 }}
                    type="number"
                    min="0"
                    placeholder="ml e.g. 200"
                    value={customMl}
                    onChange={e => setCustomMl(e.target.value)}
                  />
                )}
                {previewText && (
                  <p className={styles.previewText} style={{ marginTop: 8 }}>{previewText}</p>
                )}
              </div>
            )}
          </>
        )}

        {mode === 'recipe' && (
          <div className={styles.drawerSection}>
            <p className={styles.drawerSectionTitle}>Recipe</p>
            {selectedRecipe
              ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                  <span style={{ flex: 1, fontWeight: 600, color: '#1a2332' }}>{selectedRecipe.name}</span>
                  <button className={`${styles.btnSmall} ${styles.btnOutline}`} onClick={() => { setSelectedRecipe(null); setRecipeSearch('') }}>Change</button>
                </div>
              )
              : (
                <>
                  <input
                    className={styles.searchInput}
                    placeholder="Search recipes…"
                    value={recipeSearch}
                    onChange={e => setRecipeSearch(e.target.value)}
                    autoFocus
                  />
                  {filteredRecipes.length > 0 && (
                    <div className={styles.searchResults}>
                      {filteredRecipes.map(r => (
                        <div
                          key={r.id}
                          className={styles.searchResultItem}
                          onClick={() => { setSelectedRecipe(r); setRecipeSearch('') }}
                        >
                          {r.name}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )
            }
          </div>
        )}

        {mode === 'skip' && (
          <p style={{ fontSize: 13, color: '#6b7280' }}>
            This POS name will be ignored in future match runs and won't appear in unmatched lists.
          </p>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 'auto', paddingTop: 8, flexWrap: 'wrap' }}>
          <button className={styles.btnSecondary} onClick={() => { if (!saving) onClose() }}>Cancel</button>
          <button className={styles.btnPrimary} disabled={!canSave || saving} onClick={handleSave}>
            {saving ? 'Saving…' : 'Save mapping'}
          </button>
          {existingMapping && onUnlink && !unlinkConfirm && (
            <button className={styles.btnDanger} style={{ marginLeft: 'auto' }} onClick={() => setUnlinkConfirm(true)}>
              Unlink
            </button>
          )}
          {unlinkConfirm && (
            <div style={{ width: '100%', fontSize: 13, background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 6, padding: '10px 12px' }}>
              Delete this mapping and re-match affected reports?
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button className={styles.btnDanger} onClick={onUnlink}>Delete</button>
                <button className={styles.btnSecondary} onClick={() => setUnlinkConfirm(false)}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Bulk serving panel ────────────────────────────────────────────────────────

function BulkServingPanel({
  selectedRows,
  products,
  saving,
  onSave,
  onClose,
}: {
  selectedRows: NoServingRow[]
  products: Product[]
  saving: boolean
  onSave: (preset: string, customMl: string) => void
  onClose: () => void
}) {
  const [servingPreset, setServingPreset] = useState('each')
  const [customMl, setCustomMl] = useState('')

  const summary = useMemo(() => {
    const results = buildBulkServingPayloads(selectedRows, products, servingPreset, customMl)
    const saves = results.filter((r): r is { posName: string; docId: string; payload: Record<string, unknown> } => !('skip' in r))
    const skipped = results.filter((r): r is { posName: string; docId: string; skip: string } => 'skip' in r)
    const noSize = saves.filter(s => {
      const row = selectedRows.find(r => r.posName === s.posName)
      if (!row) return false
      const product = products.find(p => p.id === row.productId)
      return product ? productSizeInMl(product) == null : false
    })
    const exampleSave = saves[0]
    const exampleRow = exampleSave ? selectedRows.find(r => r.posName === exampleSave.posName) : null
    const exampleProduct = exampleRow ? products.find(p => p.id === exampleRow.productId) : null
    const exampleSizeMl = exampleProduct ? productSizeInMl(exampleProduct) : null
    const servingMlVal = servingPreset === 'each' ? null
      : servingPreset === 'custom' ? (parseFloat(customMl) > 0 ? parseFloat(customMl) : null)
      : SERVING_PRESETS.find(p => p.type === servingPreset)?.ml ?? null
    const examplePreview = servingMlVal && exampleSizeMl
      ? servingPreviewText(servingMlVal, exampleSizeMl)
      : servingPreset === 'each' ? '1 sale = 1 stock unit (each)'
      : null
    return { saves, skipped, noSize, examplePreview }
  }, [selectedRows, products, servingPreset, customMl])

  return (
    <div className={styles.drawerOverlay} onClick={() => { if (!saving) onClose() }}>
      <div className={styles.drawer} onClick={e => e.stopPropagation()}>
        <div>
          <button className={styles.drawerClose} onClick={() => { if (!saving) onClose() }}>×</button>
          <p className={styles.drawerTitle}>Set serving size</p>
          <p className={styles.drawerSubtitle}>{selectedRows.length} items selected</p>
        </div>

        <div className={styles.servingTypeTabs}>
          {SERVING_PRESETS.map(p => (
            <button
              key={p.type}
              className={`${styles.servingTypeBtn} ${servingPreset === p.type ? styles.servingTypeBtnActive : ''}`}
              onClick={() => setServingPreset(p.type)}
            >
              {p.label}
            </button>
          ))}
        </div>
        {servingPreset === 'custom' && (
          <input
            className={styles.searchInput}
            style={{ width: 120 }}
            type="number"
            min="0"
            placeholder="ml e.g. 200"
            value={customMl}
            onChange={e => setCustomMl(e.target.value)}
          />
        )}

        <div className={styles.confirmPanel}>
          <p style={{ fontWeight: 600, marginBottom: 6 }}>
            {summary.saves.length} item{summary.saves.length !== 1 ? 's' : ''} will be saved
          </p>
          {summary.saves.slice(0, 5).map(s => (
            <div key={s.posName} style={{ fontSize: 12, color: '#374151' }}>{s.posName}</div>
          ))}
          {summary.saves.length > 5 && <div style={{ fontSize: 12, color: '#9ca3af' }}>+{summary.saves.length - 5} more…</div>}
          {summary.examplePreview && (
            <p className={styles.previewText} style={{ marginTop: 8 }}>{summary.examplePreview}</p>
          )}
          {summary.noSize.length > 0 && servingPreset !== 'each' && (
            <p style={{ fontSize: 12, color: '#92400e', marginTop: 6 }}>
              {summary.noSize.length} product{summary.noSize.length !== 1 ? 's have' : ' has'} no size — ratio will be null
            </p>
          )}
          {summary.skipped.length > 0 && (
            <p style={{ fontSize: 12, color: '#dc2626', marginTop: 4 }}>
              {summary.skipped.length} skipped: {[...new Set(summary.skipped.map(s => s.skip))].join('; ')}
            </p>
          )}
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 'auto', paddingTop: 8 }}>
          <button className={styles.btnSecondary} onClick={() => { if (!saving) onClose() }}>Cancel</button>
          <button
            className={styles.btnPrimary}
            disabled={saving || summary.saves.length === 0 || (servingPreset === 'custom' && !(parseFloat(customMl) > 0))}
            onClick={() => onSave(servingPreset, customMl)}
          >
            {saving ? 'Saving…' : `Save ${summary.saves.length} item${summary.saves.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Re-match progress ─────────────────────────────────────────────────────────

function RematchProgress({
  done, total, errors, coverageBefore, coverageAfter,
}: {
  done: number; total: number; errors: string[]
  coverageBefore: number | null; coverageAfter: number | null
}) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  return (
    <div style={{ marginTop: 16 }}>
      <p style={{ fontSize: 13, color: '#374151', marginBottom: 4 }}>Re-matching {done}/{total} reports…</p>
      <div className={styles.progressWrap}>
        <div className={styles.progressBar} style={{ width: `${pct}%` }} />
      </div>
      {errors.length > 0 && (
        <p className={styles.errorText} style={{ marginTop: 4 }}>
          {errors.length} error{errors.length !== 1 ? 's' : ''}: {errors[0]}{errors.length > 1 ? ` +${errors.length - 1} more` : ''}
        </p>
      )}
      {done === total && total > 0 && (
        <div className={styles.coverageRow} style={{ marginTop: 6 }}>
          {coverageBefore != null && coverageAfter != null
            ? <>Coverage: <span className={styles.coveragePct}>{coverageBefore.toFixed(0)}%</span> → <span className={styles.coveragePct}>{coverageAfter.toFixed(0)}%</span></>
            : <span>Re-match complete.</span>
          }
        </div>
      )}
    </div>
  )
}

// ── Tab A: Not linked ─────────────────────────────────────────────────────────

function NotLinkedTab({
  rows,
  selected,
  onRowClick,
  onSelectionChange,
  onBulkIgnore,
  saving,
  rematching,
}: {
  rows: UnmatchedRow[]
  selected: Set<string>
  onRowClick: (row: UnmatchedRow) => void
  onSelectionChange: (sel: Set<string>) => void
  onBulkIgnore: (posNames: string[]) => void
  saving: boolean
  rematching: boolean
}) {
  const [search, setSearch] = useState('')
  const [showConfirm, setShowConfirm] = useState(false)

  const filtered = useMemo(() => {
    if (!search.trim()) return rows
    const q = search.toLowerCase()
    return rows.filter(r => r.origName.toLowerCase().includes(q))
  }, [rows, search])

  const allFilteredNorms = filtered.map(r => r.normalisedName)
  const allSelected = allFilteredNorms.length > 0 && allFilteredNorms.every(n => selected.has(n))
  const selectedNames = [...selected].map(n => rows.find(r => r.normalisedName === n)?.origName).filter(Boolean) as string[]

  function toggleAll() {
    const next = new Set(selected)
    if (allSelected) { allFilteredNorms.forEach(n => next.delete(n)) }
    else { allFilteredNorms.forEach(n => next.add(n)) }
    onSelectionChange(next)
  }

  function toggleRow(n: string) {
    const next = new Set(selected)
    if (next.has(n)) next.delete(n); else next.add(n)
    onSelectionChange(next)
  }

  if (rows.length === 0) return <p className={styles.emptyState}>No unlinked items — everything has a mapping.</p>

  return (
    <div>
      <div className={styles.tableActions}>
        <input
          className={styles.searchInput}
          style={{ width: 220 }}
          placeholder="Search POS name…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {selected.size > 0 && (
          <button
            className={`${styles.btnPrimary}`}
            disabled={saving || rematching}
            onClick={() => setShowConfirm(true)}
          >
            Ignore {selected.size} selected
          </button>
        )}
      </div>

      {showConfirm && (
        <div className={styles.confirmPanel}>
          <p style={{ fontWeight: 600, marginBottom: 6 }}>Ignore {selectedNames.length} item{selectedNames.length !== 1 ? 's' : ''}?</p>
          {selectedNames.slice(0, 5).map(n => <div key={n} style={{ fontSize: 12 }}>{n}</div>)}
          {selectedNames.length > 5 && <div style={{ fontSize: 12, color: '#9ca3af' }}>+{selectedNames.length - 5} more…</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className={styles.btnPrimary} disabled={saving || rematching} onClick={() => { setShowConfirm(false); onBulkIgnore(selectedNames) }}>Confirm</button>
            <button className={styles.btnSecondary} onClick={() => setShowConfirm(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th style={{ width: 32 }}>
                <input type="checkbox" checked={allSelected} onChange={toggleAll} />
              </th>
              <th>POS name</th>
              <th>Units sold</th>
              <th>Reports</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(r => (
              <tr key={r.normalisedName} className={styles.clickableRow} onClick={() => onRowClick(r)}>
                <td onClick={e => { e.stopPropagation(); toggleRow(r.normalisedName) }}>
                  <input type="checkbox" checked={selected.has(r.normalisedName)} onChange={() => toggleRow(r.normalisedName)} />
                </td>
                <td style={{ fontWeight: 500 }}>{r.origName}</td>
                <td>{r.totalQty}</td>
                <td>{r.reportCount}</td>
                <td>
                  <button className={`${styles.btnSmall} ${styles.btnOutline}`} onClick={e => { e.stopPropagation(); onRowClick(r) }}>Map</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Tab B: No serving size ────────────────────────────────────────────────────

function NoServingTab({
  rows,
  products,
  selected,
  onRowClick,
  onSelectionChange,
  onBulkServing,
  saving,
  rematching,
}: {
  rows: NoServingRow[]
  products: Product[]
  selected: Set<string>
  onRowClick: (row: NoServingRow) => void
  onSelectionChange: (sel: Set<string>) => void
  onBulkServing: (posNames: string[]) => void
  saving: boolean
  rematching: boolean
}) {
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')

  const categories = useMemo(() => {
    const cats = new Set<string>()
    for (const row of rows) {
      const p = products.find(pr => pr.id === row.productId)
      if (p?.category) cats.add(p.category)
    }
    return [...cats].sort()
  }, [rows, products])

  const filtered = useMemo(() => {
    let r = rows
    if (search.trim()) {
      const q = search.toLowerCase()
      r = r.filter(row => row.posName.toLowerCase().includes(q) || row.productName.toLowerCase().includes(q))
    }
    if (categoryFilter) {
      r = r.filter(row => {
        const p = products.find(pr => pr.id === row.productId)
        return p?.category === categoryFilter
      })
    }
    return r
  }, [rows, products, search, categoryFilter])

  const allFilteredNorms = filtered.map(r => r.normalisedName)
  const allSelected = allFilteredNorms.length > 0 && allFilteredNorms.every(n => selected.has(n))
  const selectedNames = [...selected].map(n => rows.find(r => r.normalisedName === n)?.posName).filter(Boolean) as string[]

  function toggleAll() {
    const next = new Set(selected)
    if (allSelected) { allFilteredNorms.forEach(n => next.delete(n)) }
    else { allFilteredNorms.forEach(n => next.add(n)) }
    onSelectionChange(next)
  }

  function toggleRow(n: string) {
    const next = new Set(selected)
    if (next.has(n)) next.delete(n); else next.add(n)
    onSelectionChange(next)
  }

  if (rows.length === 0) return <p className={styles.emptyState}>All matched items have serving sizes configured.</p>

  return (
    <div>
      <div className={styles.tableActions}>
        <input
          className={styles.searchInput}
          style={{ width: 220 }}
          placeholder="Search POS or product…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {categories.length > 0 && (
          <select
            value={categoryFilter}
            onChange={e => setCategoryFilter(e.target.value)}
            style={{ fontSize: 13, padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: 6 }}
          >
            <option value="">All categories</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        {selected.size > 0 && (
          <button
            className={styles.btnPrimary}
            disabled={saving || rematching}
            onClick={() => onBulkServing(selectedNames)}
          >
            Set serving size for {selected.size} selected
          </button>
        )}
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th style={{ width: 32 }}>
                <input type="checkbox" checked={allSelected} onChange={toggleAll} />
              </th>
              <th>POS name</th>
              <th>Matched product</th>
              <th>Units sold</th>
              <th>Reports</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(r => (
              <tr key={r.normalisedName} className={styles.clickableRow} onClick={() => onRowClick(r)}>
                <td onClick={e => { e.stopPropagation(); toggleRow(r.normalisedName) }}>
                  <input type="checkbox" checked={selected.has(r.normalisedName)} onChange={() => toggleRow(r.normalisedName)} />
                </td>
                <td style={{ fontWeight: 500 }}>{r.posName}</td>
                <td style={{ color: '#6b7280' }}>{r.productName}</td>
                <td>{r.totalQty}</td>
                <td>{r.reportIds.length}</td>
                <td>
                  <button className={`${styles.btnSmall} ${styles.btnOutline}`} onClick={e => { e.stopPropagation(); onRowClick(r) }}>Set size</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Tab C: All mappings ───────────────────────────────────────────────────────

type AllMappingsFilter = 'all' | 'product' | 'recipe' | 'ignored' | 'merged-missing' | 'no-serving'

function AllMappingsTab({
  rows,
  onRowClick,
}: {
  rows: AllMappingRow[]
  onRowClick: (row: AllMappingRow) => void
}) {
  const [search, setSearch]   = useState('')
  const [filter, setFilter]   = useState<AllMappingsFilter>('all')

  const filtered = useMemo(() => {
    let r = rows
    if (filter === 'product')       r = r.filter(row => row.mapping.mappingType === 'direct_product')
    else if (filter === 'recipe')   r = r.filter(row => row.mapping.mappingType === 'recipe')
    else if (filter === 'ignored')  r = r.filter(row => row.mapping.mappingType === 'skipped')
    else if (filter === 'merged-missing') r = r.filter(row => row.warningMergedOrMissing)
    else if (filter === 'no-serving')    r = r.filter(row => row.warningNoServing)
    if (search.trim()) {
      const q = search.toLowerCase()
      r = r.filter(row =>
        row.mapping.posItemName.toLowerCase().includes(q) ||
        row.targetLabel.toLowerCase().includes(q)
      )
    }
    return r
  }, [rows, filter, search])

  const chips: Array<{ key: AllMappingsFilter; label: string; warn?: boolean }> = [
    { key: 'all',           label: `All (${rows.length})` },
    { key: 'product',       label: `Product (${rows.filter(r => r.mapping.mappingType === 'direct_product').length})` },
    { key: 'recipe',        label: `Recipe (${rows.filter(r => r.mapping.mappingType === 'recipe').length})` },
    { key: 'ignored',       label: `Ignored (${rows.filter(r => r.mapping.mappingType === 'skipped').length})` },
    { key: 'merged-missing', label: `Points to merged/missing (${rows.filter(r => r.warningMergedOrMissing).length})`, warn: true },
    { key: 'no-serving',    label: `Product, no serving size (${rows.filter(r => r.warningNoServing).length})`, warn: true },
  ]

  if (rows.length === 0) return <p className={styles.emptyState}>No mappings found.</p>

  return (
    <div>
      <div className={styles.tableActions}>
        <input
          className={styles.searchInput}
          style={{ width: 240 }}
          placeholder="Search POS name or target…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>
      <div className={styles.filterChips}>
        {chips.map(c => (
          <button
            key={c.key}
            onClick={() => setFilter(c.key)}
            className={filter === c.key
              ? (c.warn ? styles.warnChipActive : styles.filterChipActive)
              : (c.warn ? styles.warnChip : styles.filterChip)
            }
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>POS name</th>
              <th>Type</th>
              <th>Target</th>
              <th>Serving</th>
              <th>Ratio</th>
              <th>Seen in</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(row => (
              <tr key={row.mapping.id} className={styles.clickableRow} onClick={() => onRowClick(row)}>
                <td style={{ fontWeight: 500 }}>{row.mapping.posItemName}</td>
                <td>
                  <span className={`${styles.badge} ${
                    row.mapping.mappingType === 'direct_product' ? styles.badgeBlue
                    : row.mapping.mappingType === 'recipe' ? styles.badgeGreen
                    : styles.badgeGray
                  }`}>
                    {row.mapping.mappingType === 'direct_product' ? 'product'
                      : row.mapping.mappingType === 'recipe' ? 'recipe' : 'ignored'}
                  </span>
                </td>
                <td style={{ color: row.warningMergedOrMissing ? '#92400e' : '#374151', fontSize: 12 }}>
                  {row.targetLabel}
                </td>
                <td style={{ fontSize: 12, color: '#6b7280' }}>{row.servingLabel}</td>
                <td style={{ fontSize: 12, color: '#6b7280' }}>
                  {row.ratio != null ? row.ratio.toFixed(3).replace(/\.?0+$/, '') : '—'}
                </td>
                <td style={{ fontSize: 12, color: '#6b7280' }}>
                  {row.seenInReports > 0 ? `${row.seenInReports} report${row.seenInReports !== 1 ? 's' : ''}, ${row.totalQtySold} qty` : '—'}
                </td>
                <td>
                  <button className={`${styles.btnSmall} ${styles.btnOutline}`} onClick={e => { e.stopPropagation(); onRowClick(row) }}>Edit</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function PosMappingPage({
  venueId,
  canManage,
  onNavigate: _onNavigate,
}: {
  venueId: string
  canManage: boolean
  onNavigate: (page: string) => void
}) {
  const [tab, setTab]                         = useState<TabKey>('not-linked')
  const [loading, setLoading]                 = useState(true)
  const [products, setProducts]               = useState<Product[]>([])
  const [recipes, setRecipes]                 = useState<Recipe[]>([])
  const [mappings, setMappings]               = useState<Mapping[]>([])
  const [allDocs, setAllDocs]                 = useState<Array<{ id: string; data(): Record<string, any> }>>([])
  const [matchesByReport, setMatchesByReport] = useState<Record<string, MatchData | null>>({})

  const [panelRow, setPanelRow] = useState<{
    posName: string
    preselectedProduct?: { id: string; name: string } | null
    existingMapping?: Mapping | null
    affectedReports?: { count: number; dateRange: string | null } | null
  } | null>(null)
  const [saving, setSaving]     = useState(false)

  const [notLinkedSelected, setNotLinkedSelected] = useState<Set<string>>(new Set())
  const [noServingSelected, setNoServingSelected] = useState<Set<string>>(new Set())
  const [bulkServingTarget, setBulkServingTarget] = useState<NoServingRow[] | null>(null)

  const [saveError, setSaveError] = useState<string | null>(null)

  const [rematchState, setRematchState] = useState<{
    active: boolean; done: number; total: number; errors: string[]
    coverageBefore: number | null; coverageAfter: number | null
  }>({ active: false, done: 0, total: 0, errors: [], coverageBefore: null, coverageAfter: null })

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    async function load() {
      const [productsSnap, recipesSnap, mappingsSnap, reportsSnap] = await Promise.all([
        getDocs(collection(db, 'venues', venueId, 'products')),
        getDocs(collection(db, 'venues', venueId, 'recipes')),
        getDocs(collection(db, 'venues', venueId, 'posProductMappings')),
        getDocs(collection(db, 'venues', venueId, 'salesReports')),
      ])
      if (cancelled) return
      setProducts(productsSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) })))
      setRecipes(recipesSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) })))
      setMappings(mappingsSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) })))
      const rawDocs = reportsSnap.docs.map(d => ({ id: d.id, data: () => d.data() }))
      setAllDocs(rawDocs)
      const { reports } = partitionReports(rawDocs)
      const mByR: Record<string, MatchData | null> = {}
      await Promise.all(reports.map(async r => {
        const matchSnap = await getDoc(doc(db, 'venues', venueId, 'salesReportMatches', r.id))
        mByR[r.id] = matchSnap.exists() ? matchDocToMatchData(matchSnap.data() as Record<string, any>) : null
      }))
      if (cancelled) return
      setMatchesByReport(mByR)
      setLoading(false)
    }
    load().catch(console.error)
    return () => { cancelled = true }
  }, [venueId])

  const { reports: activeReports } = useMemo(() => partitionReports(allDocs), [allDocs])

  const mappingsByLower = useMemo(() => {
    const m: MappingIndex = {}
    for (const mp of mappings) {
      const k = (mp.posItemName || '').toLowerCase()
      if (k) m[k] = { mappingType: mp.mappingType, servingMl: mp.servingMl ?? null, conversionRatio: mp.conversionRatio ?? null }
    }
    return m
  }, [mappings])

  const unmatchedRows = useMemo(() => buildUnmatchedRows(activeReports, matchesByReport), [activeReports, matchesByReport])
  const notLinkedRows = useMemo(() => buildNotLinkedRows(unmatchedRows, mappingsByLower), [unmatchedRows, mappingsByLower])
  const noServingRows = useMemo(() => buildNoServingRows(activeReports, matchesByReport, mappingsByLower), [activeReports, matchesByReport, mappingsByLower])
  const allMappingsRowsList = useMemo(() => allMappingsRows(mappings, products, recipes, activeReports, matchesByReport), [mappings, products, recipes, activeReports, matchesByReport])

  async function reloadMatchesForReports(reportIds: string[]): Promise<Record<string, MatchData | null>> {
    const updates: Record<string, MatchData | null> = {}
    await Promise.all(reportIds.map(async id => {
      const snap = await getDoc(doc(db, 'venues', venueId, 'salesReportMatches', id))
      updates[id] = snap.exists() ? matchDocToMatchData(snap.data() as Record<string, any>) : null
    }))
    return updates
  }

  function coveragePctFor(mByR: Record<string, MatchData | null>, reportIds: string[]): number | null {
    let totalQty = 0; let matchedQty = 0
    for (const id of reportIds) {
      const md = mByR[id]; if (!md?.coverage) continue
      const r = activeReports.find(a => a.id === id); if (!r) continue
      totalQty += r.totalQtySold
      matchedQty += r.totalQtySold * ((md.coverage.matchedPct ?? 0) + (md.coverage.recipePct ?? 0) + (md.coverage.ignoredPct ?? 0)) / 100
    }
    return totalQty > 0 ? (matchedQty / totalQty) * 100 : null
  }

  async function runRematch(affectedIds: string[], currentMatchesByReport: Record<string, MatchData | null>) {
    if (affectedIds.length === 0) return
    const coverageBefore = coveragePctFor(currentMatchesByReport, affectedIds)
    const token = await auth.currentUser?.getIdToken()
    if (!token) return
    setRematchState({ active: true, done: 0, total: affectedIds.length, errors: [], coverageBefore, coverageAfter: null })
    const { errors } = await rematchReports(venueId, affectedIds, token, (done, total) => {
      setRematchState(s => ({ ...s, done, total }))
    })
    const updated = await reloadMatchesForReports(affectedIds)
    setMatchesByReport(prev => ({ ...prev, ...updated }))
    const coverageAfter = coveragePctFor({ ...currentMatchesByReport, ...updated }, affectedIds)
    setRematchState(s => ({ ...s, errors, coverageAfter }))
  }

  type SaveEntry = { posName: string; docId: string; payload: Record<string, unknown>; existingCreatedAt?: unknown }

  async function saveMappings(entries: SaveEntry[]): Promise<{ savedNames: string[]; failed: boolean }> {
    if (!canManage) return { savedNames: [], failed: false }
    setSaving(true)
    setSaveError(null)
    const savedNames: string[] = []
    try {
      const chunks = chunkArray(entries, 400)
      for (const chunk of chunks) {
        try {
          const batch = writeBatch(db)
          for (const entry of chunk) {
            const docRef = doc(db, 'venues', venueId, 'posProductMappings', entry.docId)
            batch.set(docRef, {
              ...entry.payload,
              createdAt: entry.existingCreatedAt ?? serverTimestamp(),
              updatedAt: serverTimestamp(),
            })
          }
          await batch.commit()
          savedNames.push(...chunk.map(e => e.posName))
        } catch (e: any) {
          console.error('batch failed', e)
          const total = entries.length
          setSaveError(`Saved ${savedNames.length} of ${total}. Failed at: ${entries[savedNames.length]?.posName ?? '?'}`)
          setSaving(false)
          return { savedNames, failed: true }
        }
      }

      // Mark salesReportUnknowns as mapped (best-effort, batched)
      const savedNorms = new Set(savedNames.map(n => wlNormName(n)))
      try {
        const unknownsSnap = await getDocs(
          query(collection(db, 'venues', venueId, 'salesReportUnknowns'), where('status', '==', 'unmapped'))
        )
        const toMark = unknownsSnap.docs.filter(d => {
          const lineName = (d.data()?.line?.name as string | undefined) ?? ''
          return savedNorms.has(wlNormName(lineName))
        })
        if (toMark.length > 0) {
          const unknownChunks = chunkArray(toMark, 400)
          for (const chunk of unknownChunks) {
            const batch = writeBatch(db)
            chunk.forEach(d => batch.update(d.ref, { status: 'mapped' }))
            await batch.commit()
          }
        }
      } catch { /* best-effort */ }

      // Update local mappings state
      setMappings(prev => {
        let updated = [...prev]
        for (const entry of entries) {
          const filtered = updated.filter(m => m.id !== entry.docId)
          const newMapping: Mapping = { id: entry.docId, posItemName: entry.posName, posSystem: 'csv', ...(entry.payload as any) }
          updated = [...filtered, newMapping]
        }
        return updated
      })

      // Re-match affected reports once
      const affectedIds = unionReportIds(savedNames, activeReports)
      if (affectedIds.length > 0) {
        await runRematch(affectedIds, matchesByReport)
      }

      return { savedNames, failed: false }
    } catch (e: any) {
      console.error('saveMappings failed', e)
      setSaveError(`Save failed: ${e?.message ?? 'unknown error'}`)
      return { savedNames, failed: true }
    } finally {
      setSaving(false)
    }
  }

  async function handlePanelSave(payload: Record<string, unknown>, posName: string, existingCreatedAt?: unknown) {
    if (!canManage) return
    const docId = mappingDocId(posName, 'csv')
    const { failed } = await saveMappings([{ posName, docId, payload, existingCreatedAt }])
    if (!failed) setPanelRow(null)
  }

  async function handleUnlink(mapping: Mapping) {
    if (!canManage) return
    setSaving(true)
    try {
      await deleteDoc(doc(db, 'venues', venueId, 'posProductMappings', mapping.id))
      setMappings(prev => prev.filter(m => m.id !== mapping.id))
      setPanelRow(null)
      const affectedIds = unionReportIds([mapping.posItemName], activeReports)
      if (affectedIds.length > 0) await runRematch(affectedIds, matchesByReport)
    } catch (e: any) {
      console.error('unlink failed', e)
    } finally {
      setSaving(false)
    }
  }

  async function handleBulkIgnore(posNames: string[]) {
    const payloads = buildBulkIgnorePayloads(posNames)
    const { failed } = await saveMappings(payloads)
    if (!failed) setNotLinkedSelected(new Set())
  }

  async function handleBulkServing(servingPreset: string, customMl: string) {
    if (!bulkServingTarget) return
    const results = buildBulkServingPayloads(bulkServingTarget, products, servingPreset, customMl)
    const toSave = results.filter((r): r is { posName: string; docId: string; payload: Record<string, unknown> } => !('skip' in r))
    const { failed } = await saveMappings(toSave)
    if (!failed) { setNoServingSelected(new Set()); setBulkServingTarget(null) }
  }

  async function handleRematchAll() {
    if (!canManage || saving || rematchState.active) return
    const allIds = activeReports.map(r => r.id)
    await runRematch(allIds, matchesByReport)
  }

  function openAllMappingRow(row: AllMappingRow) {
    if (!canManage) return
    const norm = wlNormName(row.mapping.posItemName ?? '')
    const affectedIds = activeReports.filter(r => r.rawLines.some(l => wlNormName(l.name ?? '') === norm))
    const dates = affectedIds.map(r => r.startStr).filter(Boolean).sort() as string[]
    const dateRange = dates.length >= 2 ? `${dates[0]} – ${dates[dates.length - 1]}`
      : dates.length === 1 ? dates[0] : null
    setPanelRow({
      posName: row.mapping.posItemName,
      existingMapping: row.mapping,
      affectedReports: { count: affectedIds.length, dateRange },
    })
  }

  if (loading) return <div className={styles.page}><p className={styles.loading}>Loading POS mapping data…</p></div>

  return (
    <div className={styles.page}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap' }}>
        <h1 className={styles.heading}>POS Mapping</h1>
        {canManage && (
          <button
            className={`${styles.btnSmall} ${styles.btnOutline}`}
            disabled={saving || rematchState.active}
            onClick={handleRematchAll}
            style={{ marginBottom: 4 }}
          >
            Re-match all active reports
          </button>
        )}
      </div>
      <p className={styles.subheading}>
        {notLinkedRows.length} unlinked · {noServingRows.length} missing serving size · {mappings.length} total mappings
      </p>

      {saveError && (
        <div className={`${styles.banner} ${styles.bannerAmber}`} style={{ marginBottom: 8 }}>
          {saveError}
        </div>
      )}

      {rematchState.active && (
        <RematchProgress
          done={rematchState.done} total={rematchState.total}
          errors={rematchState.errors}
          coverageBefore={rematchState.coverageBefore}
          coverageAfter={rematchState.coverageAfter}
        />
      )}

      <div className={styles.tabs}>
        {([
          { key: 'not-linked' as const, label: `Not linked (${notLinkedRows.length})` },
          { key: 'no-serving' as const, label: `No serving size (${noServingRows.length})` },
          { key: 'all-mappings' as const, label: `All mappings (${mappings.length})` },
        ]).map(t => (
          <button
            key={t.key}
            className={`${styles.tab} ${tab === t.key ? styles.tabActive : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {!canManage && (
        <div className={`${styles.banner} ${styles.bannerAmber}`}>
          You have read-only access. Ask an owner or manager to save mappings.
        </div>
      )}

      {tab === 'not-linked' && (
        <NotLinkedTab
          rows={notLinkedRows}
          selected={notLinkedSelected}
          onRowClick={row => canManage && setPanelRow({ posName: row.origName })}
          onSelectionChange={setNotLinkedSelected}
          onBulkIgnore={handleBulkIgnore}
          saving={saving}
          rematching={rematchState.active && rematchState.done < rematchState.total}
        />
      )}

      {tab === 'no-serving' && (
        <NoServingTab
          rows={noServingRows}
          products={products}
          selected={noServingSelected}
          onRowClick={row => canManage && setPanelRow({
            posName: row.posName,
            preselectedProduct: { id: row.productId, name: row.productName },
          })}
          onSelectionChange={setNoServingSelected}
          onBulkServing={posNames => {
            const selectedRows = noServingRows.filter(r => posNames.includes(r.posName))
            setBulkServingTarget(selectedRows)
          }}
          saving={saving}
          rematching={rematchState.active && rematchState.done < rematchState.total}
        />
      )}

      {tab === 'all-mappings' && (
        <AllMappingsTab rows={allMappingsRowsList} onRowClick={openAllMappingRow} />
      )}

      {panelRow && (
        <MappingPanel
          posName={panelRow.posName}
          preselectedProduct={panelRow.preselectedProduct}
          existingMapping={panelRow.existingMapping}
          affectedReports={panelRow.affectedReports}
          products={products}
          recipes={recipes}
          saving={saving}
          onSave={handlePanelSave}
          onClose={() => setPanelRow(null)}
          onUnlink={panelRow.existingMapping ? () => handleUnlink(panelRow.existingMapping!) : undefined}
        />
      )}

      {bulkServingTarget && (
        <BulkServingPanel
          selectedRows={bulkServingTarget}
          products={products}
          saving={saving}
          onSave={handleBulkServing}
          onClose={() => setBulkServingTarget(null)}
        />
      )}
    </div>
  )
}
