import { useEffect, useMemo, useState } from 'react'
import {
  collection, doc, getDocs, getDoc, query,
  setDoc, serverTimestamp, where, writeBatch,
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

type Product = { id: string; name: string; size?: string | null; unit?: string | null }
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
}

export type NoServingRow = {
  posName: string
  normalisedName: string
  productId: string
  productName: string
  totalQty: number
  reportIds: string[]
}

type TabKey = 'not-linked' | 'no-serving'

// ── Pure exports (used by tests) ──────────────────────────────────────────────

export function buildNotLinkedRows(
  rows: UnmatchedRow[],
  mappingsByLower: Record<string, { mappingType: string }>,
): UnmatchedRow[] {
  return rows.filter(r => !mappingsByLower[(r.origName || '').toLowerCase()])
}

export function buildNoServingRows(
  activeReports: ActiveReport[],
  matchesByReport: Record<string, MatchData | null>,
): NoServingRow[] {
  const byNorm = new Map<string, NoServingRow>()
  for (const r of activeReports) {
    const md = matchesByReport[r.id]
    if (!md) continue
    for (const m of md.matches) {
      if (m.conversionSource !== 'default') continue
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

// ── Serving preset helpers ────────────────────────────────────────────────────

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
  if (!p.size || !p.unit) return null
  const parsed = parseProductSize(p.size, p.unit)
  if (!parsed || parsed.base !== 'ml') return null
  return parsed.amount
}

// ── Mapping panel ─────────────────────────────────────────────────────────────

function MappingPanel({
  posName,
  preselectedProduct,
  products,
  recipes,
  saving,
  onSave,
  onClose,
}: {
  posName: string
  preselectedProduct?: { id: string; name: string } | null
  products: Product[]
  recipes: Recipe[]
  saving: boolean
  onSave: (payload: ReturnType<typeof buildSavePayload>, posName: string) => void
  onClose: () => void
}) {
  const [mode, setMode]               = useState<'product' | 'recipe' | 'skip'>('product')
  const [productSearch, setProductSearch] = useState('')
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(
    preselectedProduct ? products.find(p => p.id === preselectedProduct.id) ?? null : null
  )
  const [servingPreset, setServingPreset] = useState<string>('each')
  const [customMl, setCustomMl]       = useState('')
  const [recipeSearch, setRecipeSearch] = useState('')
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null)

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
    const ratio = servingPreset === 'each'
      ? null
      : servingMl != null && sizeMl != null
        ? servingMl / sizeMl
        : servingPreset === 'custom' && parseFloat(customMl) > 0
          ? null  // servingMl will be stored without ratio if size unknown
          : null
    onSave(buildSavePayload(posName, 'csv', 'direct_product', {
      productId:       selectedProduct.id,
      productName:     selectedProduct.name,
      servingMl:       servingPreset !== 'each' ? servingMl : null,
      conversionRatio: ratio,
      servingType:     servingPreset,
      conversionUnit:  servingPreset === 'each' ? 'each' : 'ml',
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
          <p className={styles.drawerSubtitle}>Set how this POS name maps to your catalogue</p>
        </div>

        {/* Mode selector */}
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

        <div style={{ display: 'flex', gap: 10, marginTop: 'auto', paddingTop: 8 }}>
          <button className={styles.btnSecondary} onClick={() => { if (!saving) onClose() }}>Cancel</button>
          <button className={styles.btnPrimary} disabled={!canSave || saving} onClick={handleSave}>
            {saving ? 'Saving…' : 'Save mapping'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Re-match progress ─────────────────────────────────────────────────────────

function RematchProgress({
  done,
  total,
  errors,
  coverageBefore,
  coverageAfter,
}: {
  done: number
  total: number
  errors: string[]
  coverageBefore: number | null
  coverageAfter: number | null
}) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  return (
    <div style={{ marginTop: 16 }}>
      <p style={{ fontSize: 13, color: '#374151', marginBottom: 4 }}>
        Re-matching {done}/{total} reports…
      </p>
      <div className={styles.progressWrap}>
        <div className={styles.progressBar} style={{ width: `${pct}%` }} />
      </div>
      {errors.length > 0 && (
        <p className={styles.errorText} style={{ marginTop: 4 }}>
          {errors.length} error{errors.length !== 1 ? 's' : ''} (continued): {errors[0]}
          {errors.length > 1 && ` +${errors.length - 1} more`}
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
  onRowClick,
}: {
  rows: UnmatchedRow[]
  onRowClick: (row: UnmatchedRow) => void
}) {
  if (rows.length === 0) return <p className={styles.emptyState}>No unlinked items — everything has a mapping.</p>

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>POS name</th>
            <th>Units sold</th>
            <th>Reports</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.normalisedName} className={styles.clickableRow} onClick={() => onRowClick(r)}>
              <td style={{ fontWeight: 500 }}>{r.origName}</td>
              <td>{r.totalQty}</td>
              <td>{r.reportCount}</td>
              <td>
                <button className={`${styles.btnSmall} ${styles.btnOutline}`} onClick={e => { e.stopPropagation(); onRowClick(r) }}>
                  Map
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Tab B: No serving size ────────────────────────────────────────────────────

function NoServingTab({
  rows,
  onRowClick,
}: {
  rows: NoServingRow[]
  onRowClick: (row: NoServingRow) => void
}) {
  if (rows.length === 0) return <p className={styles.emptyState}>All matched items have serving sizes configured.</p>

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>POS name</th>
            <th>Matched product</th>
            <th>Units sold</th>
            <th>Reports</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.normalisedName} className={styles.clickableRow} onClick={() => onRowClick(r)}>
              <td style={{ fontWeight: 500 }}>{r.posName}</td>
              <td style={{ color: '#6b7280' }}>{r.productName}</td>
              <td>{r.totalQty}</td>
              <td>{r.reportIds.length}</td>
              <td>
                <button className={`${styles.btnSmall} ${styles.btnOutline}`} onClick={e => { e.stopPropagation(); onRowClick(r) }}>
                  Set size
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
  const [tab, setTab]                       = useState<TabKey>('not-linked')
  const [loading, setLoading]               = useState(true)
  const [products, setProducts]             = useState<Product[]>([])
  const [recipes, setRecipes]               = useState<Recipe[]>([])
  const [mappings, setMappings]             = useState<Mapping[]>([])
  const [allDocs, setAllDocs]               = useState<Array<{ id: string; data(): Record<string, any> }>>([])
  const [matchesByReport, setMatchesByReport] = useState<Record<string, MatchData | null>>({})

  const [panelRow, setPanelRow]             = useState<{ posName: string; preselectedProduct?: { id: string; name: string } | null } | null>(null)
  const [saving, setSaving]                 = useState(false)

  const [rematchState, setRematchState]     = useState<{
    active: boolean; done: number; total: number; errors: string[];
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
    const m: Record<string, { mappingType: string }> = {}
    for (const mp of mappings) {
      const k = (mp.posItemName || '').toLowerCase()
      if (k) m[k] = { mappingType: mp.mappingType }
    }
    return m
  }, [mappings])

  const unmatchedRows = useMemo(
    () => buildUnmatchedRows(activeReports, matchesByReport),
    [activeReports, matchesByReport],
  )

  const notLinkedRows = useMemo(
    () => buildNotLinkedRows(unmatchedRows, mappingsByLower),
    [unmatchedRows, mappingsByLower],
  )

  const noServingRows = useMemo(
    () => buildNoServingRows(activeReports, matchesByReport),
    [activeReports, matchesByReport],
  )

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
      const md = mByR[id]
      if (!md?.coverage) continue
      const r = activeReports.find(a => a.id === id)
      if (!r) continue
      totalQty   += r.totalQtySold
      matchedQty += r.totalQtySold * ((md.coverage.matchedPct ?? 0) + (md.coverage.recipePct ?? 0) + (md.coverage.ignoredPct ?? 0)) / 100
    }
    return totalQty > 0 ? (matchedQty / totalQty) * 100 : null
  }

  async function handleSave(payload: Record<string, unknown>, posName: string) {
    if (!canManage) return
    setSaving(true)
    try {
      const docId = mappingDocId(posName, 'csv')
      await setDoc(
        doc(db, 'venues', venueId, 'posProductMappings', docId),
        { ...payload, createdAt: serverTimestamp(), updatedAt: serverTimestamp() },
        { merge: true },
      )

      // Mark salesReportUnknowns with matching name as 'mapped'
      const wlNorm = wlNormName(posName)
      try {
        const unknownsSnap = await getDocs(
          query(collection(db, 'venues', venueId, 'salesReportUnknowns'), where('status', '==', 'unmapped'))
        )
        const toMark = unknownsSnap.docs.filter(d => {
          const lineName = (d.data()?.line?.name as string | undefined) ?? ''
          return wlNormName(lineName) === wlNorm
        })
        if (toMark.length > 0) {
          const batch = writeBatch(db)
          toMark.forEach(d => batch.update(d.ref, { status: 'mapped' }))
          await batch.commit()
        }
      } catch {
        // best-effort
      }

      // Update local mappings state immediately
      const newMapping: Mapping = { id: docId, posItemName: posName, posSystem: 'csv', ...(payload as any) }
      setMappings(prev => {
        const filtered = prev.filter(m => m.id !== docId)
        return [...filtered, newMapping]
      })
      setPanelRow(null)

      // Re-match affected reports
      const affectedIds = activeReports
        .filter(r => r.rawLines.some(l => wlNormName(l.name ?? '') === wlNorm))
        .map(r => r.id)

      if (affectedIds.length === 0) return

      const coverageBefore = coveragePctFor(matchesByReport, affectedIds)
      const token = await auth.currentUser?.getIdToken()
      if (!token) return

      setRematchState({ active: true, done: 0, total: affectedIds.length, errors: [], coverageBefore, coverageAfter: null })

      const { errors } = await rematchReports(venueId, affectedIds, token, (done, total) => {
        setRematchState(s => ({ ...s, done, total }))
      })

      const updated = await reloadMatchesForReports(affectedIds)
      setMatchesByReport(prev => ({ ...prev, ...updated }))
      const coverageAfter = coveragePctFor({ ...matchesByReport, ...updated }, affectedIds)
      setRematchState(s => ({ ...s, errors, coverageAfter }))

    } catch (e: any) {
      console.error('save mapping failed', e)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className={styles.page}><p className={styles.loading}>Loading POS mapping data…</p></div>

  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>POS Mapping</h1>
      <p className={styles.subheading}>
        {notLinkedRows.length} unlinked · {noServingRows.length} missing serving size
      </p>

      {rematchState.active && (
        <RematchProgress
          done={rematchState.done}
          total={rematchState.total}
          errors={rematchState.errors}
          coverageBefore={rematchState.coverageBefore}
          coverageAfter={rematchState.coverageAfter}
        />
      )}

      <div className={styles.tabs}>
        {([
          { key: 'not-linked' as const, label: `Not linked (${notLinkedRows.length})` },
          { key: 'no-serving' as const, label: `No serving size (${noServingRows.length})` },
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
          onRowClick={row => canManage && setPanelRow({ posName: row.origName })}
        />
      )}

      {tab === 'no-serving' && (
        <NoServingTab
          rows={noServingRows}
          onRowClick={row => canManage && setPanelRow({
            posName: row.posName,
            preselectedProduct: { id: row.productId, name: row.productName },
          })}
        />
      )}

      {panelRow && (
        <MappingPanel
          posName={panelRow.posName}
          preselectedProduct={panelRow.preselectedProduct}
          products={products}
          recipes={recipes}
          saving={saving}
          onSave={handleSave}
          onClose={() => setPanelRow(null)}
        />
      )}
    </div>
  )
}
