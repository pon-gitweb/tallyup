import { Fragment, useEffect, useMemo, useState } from 'react'
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, onSnapshot, orderBy, query, serverTimestamp, updateDoc } from 'firebase/firestore'
import { BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { db } from '../firebase'
import { theme } from '../theme'
import {
  CHART_TOOLTIP_STYLE, CHART_GRID_PROPS, CHART_AXIS_TICK, CHART_ANIMATION, CHART_HEIGHT_BAR,
} from '../chartConfig'
import { ChartEmptyState } from '../components/ChartEmptyState'
import styles from './CraftItPage.module.css'

// ─── Types ────────────────────────────────────────────────────────────────────

type RecipeItem = {
  productId: string | null
  name: string
  qty: number
  unit: string | null
  costPerUnit: number | null
  lineTotal: number | null
}

type Recipe = {
  id: string
  name: string
  status: 'draft' | 'confirmed'
  category: 'food' | 'beverage' | null
  mode: 'single' | 'batch' | 'dish' | null
  cogs: number | null
  rrp: number | null
  gpPercent: number | null
  items: RecipeItem[]
  updatedAt: Date | null
  isPartial: boolean
}

type StatusFilter = 'all' | 'confirmed' | 'draft'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function computeGp(cogs: number | null, rrp: number | null): number | null {
  if (cogs == null || rrp == null || rrp <= 0) return null
  return Math.round(((rrp - cogs) / rrp) * 100)
}

function gpColor(pct: number | null): string {
  if (pct == null) return theme.slateMid
  if (pct >= 70) return theme.success
  if (pct >= 60) return theme.amber
  return theme.error
}

function fmtCost(v: number | null | undefined): string {
  if (v == null) return '—'
  return '$' + v.toFixed(2)
}

function fmtDate(d: Date | null): string {
  if (!d) return '—'
  return d.toLocaleDateString('en-NZ', { day: '2-digit', month: 'short', year: 'numeric' })
}

function modeLabel(mode: Recipe['mode']): string {
  switch (mode) {
    case 'single': return 'Per serve'
    case 'batch':  return 'Batch'
    case 'dish':   return 'Dish'
    default:       return '—'
  }
}

function categoryLabel(cat: Recipe['category']): string {
  switch (cat) {
    case 'food':     return '🍽 Food'
    case 'beverage': return '🍹 Beverage'
    default:         return '—'
  }
}

function escCsv(v: unknown): string {
  const s = String(v ?? '')
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g, '""')}"`
    : s
}

function downloadCsv(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

const EMPTY_MESSAGES: Record<StatusFilter, { title: string; note: string }> = {
  all: {
    title: 'No recipes yet',
    note: 'Create your first recipe in the CraftIt section of the mobile app.',
  },
  confirmed: {
    title: 'No confirmed recipes yet',
    note: 'Confirm a recipe in the mobile app to see it here.',
  },
  draft: {
    title: 'No draft recipes',
    note: 'Draft recipes will appear here once created on mobile.',
  },
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CraftItPage({ venueId }: { venueId: string }) {
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [isNewRecipe, setIsNewRecipe] = useState(false)

  useEffect(() => {
    setLoading(true)
    setError(false)
    setExpandedId(null)

    const q = query(
      collection(db, 'venues', venueId, 'recipes'),
      orderBy('updatedAt', 'desc'),
    )

    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows: Recipe[] = snap.docs.map((d) => {
          const data = d.data() as any
          const items: RecipeItem[] = (data.items ?? data.ingredients ?? []).map((it: any) => ({
            productId: it.productId ?? null,
            name: it.name ?? it.productName ?? '—',
            qty: it.qty ?? it.quantity ?? 0,
            unit: it.unit ?? null,
            costPerUnit: it.costPerUnit ?? it.unitCost ?? null,
            lineTotal: it.lineTotal ?? it.totalCost ?? null,
          }))
          const isPartial = items.some((it) => it.costPerUnit == null)
          const cogs = data.cogs ?? data.totalCost ?? null
          const rrp = data.rrp ?? data.sellingPrice ?? null
          return {
            id: d.id,
            name: data.name || '—',
            status: data.status === 'confirmed' ? 'confirmed' : 'draft',
            category: data.category === 'food' ? 'food' : data.category === 'beverage' ? 'beverage' : null,
            mode: ['single', 'batch', 'dish'].includes(data.mode) ? data.mode : null,
            cogs,
            rrp,
            gpPercent: computeGp(cogs, rrp),
            items,
            updatedAt: data.updatedAt?.toDate?.() ?? null,
            isPartial,
          }
        })
        setRecipes(rows)
        setLoading(false)
      },
      () => {
        setError(true)
        setLoading(false)
      },
    )
    return unsub
  }, [venueId])

  const filtered = useMemo(() => {
    let rows = recipes
    if (filter !== 'all') rows = rows.filter((r) => r.status === filter)
    const needle = search.trim().toLowerCase()
    if (needle) rows = rows.filter((r) => r.name.toLowerCase().includes(needle))
    return rows
  }, [recipes, filter, search])

  const stats = useMemo(() => {
    const confirmed = recipes.filter((r) => r.status === 'confirmed')
    const withGp = confirmed.filter((r) => r.gpPercent != null)
    const avgGp =
      withGp.length > 0
        ? Math.round(withGp.reduce((s, r) => s + (r.gpPercent ?? 0), 0) / withGp.length)
        : null
    return { total: recipes.length, confirmedCount: confirmed.length, avgGp }
  }, [recipes])

  // ── Chart C: GP distribution ──────────────────────────────────────────────
  const gpBuckets = useMemo(() => {
    const conf = recipes.filter((r) => r.status === 'confirmed' && r.gpPercent != null)
    return [
      { bucket: 'Below 50%', count: conf.filter((r) => r.gpPercent! < 50).length,                       fill: theme.error },
      { bucket: '50–59%',    count: conf.filter((r) => r.gpPercent! >= 50 && r.gpPercent! < 60).length, fill: '#f97316' },
      { bucket: '60–69%',    count: conf.filter((r) => r.gpPercent! >= 60 && r.gpPercent! < 70).length, fill: theme.amber },
      { bucket: '70–79%',    count: conf.filter((r) => r.gpPercent! >= 70 && r.gpPercent! < 80).length, fill: theme.success },
      { bucket: '80%+',      count: conf.filter((r) => r.gpPercent! >= 80).length,                       fill: '#15803d' },
    ]
  }, [recipes])

  const confirmedWithGp = recipes.filter((r) => r.status === 'confirmed' && r.gpPercent != null).length

  function handleNewRecipe() {
    setEditingId(null)
    setIsNewRecipe(true)
    setExpandedId(null)
  }

  function exportCsv() {
    const dateStr = new Date().toISOString().slice(0, 10)
    let csv = 'Name,Category,Mode,COGS,RRP,GP%,Status\n'
    for (const r of filtered) {
      csv +=
        [
          escCsv(r.name),
          escCsv(categoryLabel(r.category)),
          escCsv(modeLabel(r.mode)),
          r.cogs != null ? r.cogs.toFixed(2) : '',
          r.rrp != null ? r.rrp.toFixed(2) : '',
          r.gpPercent != null ? r.gpPercent + '%' : '',
          escCsv(r.status),
        ].join(',') + '\n'
    }
    downloadCsv(`craftit-recipes-${dateStr}.csv`, csv)
  }

  if (loading) return <p className={styles.loading}>Loading recipes…</p>
  if (error) return <p className={styles.errorText}>Could not load recipes. Please try again.</p>

  const emptyMsg = EMPTY_MESSAGES[filter]

  return (
    <div className={(editingId || isNewRecipe) ? styles.pageWithEditor : styles.page}>
      <div>
      <h1 className={styles.heading}>CraftIt</h1>
      <p className={styles.subhead}>Recipe library with GP analysis. Authoring stays on mobile.</p>

      {/* ── Summary stats ── */}
      <div className={styles.statsRow}>
        <div className={styles.statCard}>
          <p className={styles.statValue}>{stats.total}</p>
          <p className={styles.statLabel}>Total recipes</p>
        </div>
        <div className={styles.statCard}>
          <p className={styles.statValue}>{stats.confirmedCount}</p>
          <p className={styles.statLabel}>Confirmed</p>
        </div>
        <div className={styles.statCard}>
          <p
            className={styles.statValue}
            style={{ color: stats.avgGp != null ? gpColor(stats.avgGp) : theme.slateMid }}
          >
            {stats.avgGp != null ? `${stats.avgGp}%` : '—'}
          </p>
          <p className={styles.statLabel}>Avg GP % (confirmed)</p>
        </div>
      </div>

      {/* ── Chart C: GP distribution ── */}
      <div className={styles.chartCard}>
        <p className={styles.chartTitle}>GP % distribution</p>
        <p className={styles.chartSubtitle}>Confirmed recipes only</p>
        {confirmedWithGp < 3 ? (
          <ChartEmptyState
            icon="🍹"
            title="No GP data yet"
            body="Confirm recipes to see how your GP% is distributed. Aim for 70%+ on beverages."
            height={CHART_HEIGHT_BAR}
          />
        ) : (
          <ResponsiveContainer width="100%" height={CHART_HEIGHT_BAR}>
            <BarChart data={gpBuckets} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid {...CHART_GRID_PROPS} />
              <XAxis dataKey="bucket" tick={CHART_AXIS_TICK} axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} tick={CHART_AXIS_TICK} width={32} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={CHART_TOOLTIP_STYLE}
                formatter={((v: number, _name: string, props: any) => [`${v} recipe${v !== 1 ? 's' : ''}`, props?.payload?.bucket ?? '']) as any}
                labelFormatter={(() => '') as any}
                cursor={{ fill: 'rgba(11,19,43,0.03)' }} />
              <Bar dataKey="count" radius={[4, 4, 0, 0]} {...CHART_ANIMATION}>
                {gpBuckets.map((entry, i) => (
                  <Cell key={i} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
        <p className={styles.chartBenchmark}>Target: 70%+ for beverages · 65%+ for food dishes</p>
      </div>

      {/* ── Filter row ── */}
      <div className={styles.filterRow}>
        <div className={styles.filterGroup}>
          {(['all', 'confirmed', 'draft'] as const).map((f) => (
            <button
              key={f}
              type="button"
              className={`${styles.filterChip} ${filter === f ? styles.filterChipActive : ''}`}
              onClick={() => { setFilter(f); setExpandedId(null) }}
            >
              {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        <input
          className={styles.searchInput}
          placeholder="Search recipes…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className={styles.filterSpacer} />
        <button type="button" className={styles.exportBtn} onClick={exportCsv}>
          Export CSV
        </button>
        <button type="button" className={styles.newRecipeBtn} onClick={handleNewRecipe}>
          + New recipe
        </button>
      </div>

      {/* ── Table or empty state ── */}
      {filtered.length === 0 ? (
        <div className={styles.emptyState}>
          <p className={styles.emptyTitle}>{emptyMsg.title}</p>
          <p className={styles.emptyNote}>{emptyMsg.note}</p>
        </div>
      ) : (
        <>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Category</th>
                  <th>Mode</th>
                  <th>COGS</th>
                  <th>RRP</th>
                  <th>GP %</th>
                  <th>Status</th>
                  <th>Last updated</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((recipe) => {
                  const isExpanded = expandedId === recipe.id
                  const subtotal = recipe.items.reduce((s, it) => s + (it.lineTotal ?? 0), 0)

                  return (
                    <Fragment key={recipe.id}>
                      <tr className={styles.dataRow} onClick={() => {
                          if (editingId === recipe.id) {
                            setEditingId(null)
                          } else {
                            setEditingId(recipe.id)
                            setIsNewRecipe(false)
                            setExpandedId(null)
                          }
                        }}>
                        <td className={styles.td} style={{ fontWeight: 600 }}>{recipe.name}</td>
                        <td className={styles.td}>{categoryLabel(recipe.category)}</td>
                        <td className={styles.td}>{modeLabel(recipe.mode)}</td>
                        <td className={styles.tdNum}>{fmtCost(recipe.cogs)}</td>
                        <td className={styles.tdNum}>{fmtCost(recipe.rrp)}</td>
                        <td
                          className={styles.tdNum}
                          style={{
                            color: gpColor(recipe.gpPercent),
                            fontWeight: recipe.gpPercent != null ? 700 : 400,
                          }}
                        >
                          {recipe.gpPercent != null ? `${recipe.gpPercent}%` : '—'}
                        </td>
                        <td className={styles.td}>
                          <span
                            className={`${styles.badge} ${recipe.status === 'confirmed' ? styles.badgeConfirmed : styles.badgeDraft}`}
                          >
                            {recipe.status}
                          </span>
                        </td>
                        <td className={styles.td}>{fmtDate(recipe.updatedAt)}</td>
                      </tr>

                      {isExpanded && (
                        <tr className={styles.expandRow}>
                          <td colSpan={8} className={styles.expandCell}>
                            {recipe.isPartial && (
                              <p className={styles.partialNote}>
                                ⚠️ Some ingredients have no price — cost is incomplete.
                              </p>
                            )}
                            {recipe.items.length === 0 ? (
                              <p style={{ fontSize: 13, color: theme.slateMid, margin: 0 }}>
                                No ingredients recorded.
                              </p>
                            ) : (
                              <table className={styles.ingredientsTable}>
                                <thead>
                                  <tr>
                                    <th>Ingredient</th>
                                    <th>Qty</th>
                                    <th>Unit</th>
                                    <th>Cost per unit</th>
                                    <th>Line total</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {recipe.items.map((item, i) => (
                                    <tr key={`${item.productId ?? item.name}-${i}`}>
                                      <td className={styles.ingTd}>{item.name}</td>
                                      <td className={styles.ingTdNum}>{item.qty}</td>
                                      <td className={styles.ingTd}>{item.unit ?? '—'}</td>
                                      <td className={styles.ingTdNum}>{fmtCost(item.costPerUnit)}</td>
                                      <td className={styles.ingTdNum}>{fmtCost(item.lineTotal)}</td>
                                    </tr>
                                  ))}
                                  <tr className={styles.subtotalRow}>
                                    <td
                                      colSpan={4}
                                      className={styles.ingTd}
                                      style={{ fontWeight: 700, color: theme.navy }}
                                    >
                                      Subtotal
                                    </td>
                                    <td
                                      className={styles.ingTdNum}
                                      style={{ fontWeight: 700, color: theme.navy }}
                                    >
                                      {subtotal > 0 ? fmtCost(subtotal) : '—'}
                                    </td>
                                  </tr>
                                </tbody>
                              </table>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className={styles.benchmarkNote}>
            GP % benchmarks: 70%+ excellent · 60–69% healthy · below 60% review pricing.
          </p>
        </>
      )}
      </div>
      {(editingId !== null || isNewRecipe) && (
        <div className={styles.editorPanel}>
          <RecipeEditor
            venueId={venueId}
            recipeId={editingId}
            onClose={() => { setEditingId(null); setIsNewRecipe(false) }}
            onSaved={(id) => { setEditingId(id); setIsNewRecipe(false) }}
          />
        </div>
      )}
    </div>
  )
}

// ─── RecipeEditor ─────────────────────────────────────────────────────────────

function RecipeEditor({ venueId, recipeId, onClose, onSaved }: {
  venueId: string
  recipeId: string | null
  onClose: () => void
  onSaved: (id: string) => void
}) {
  const [name, setName] = useState('')
  const [category, setCategory] = useState<'food' | 'beverage' | null>(null)
  const [mode, setMode] = useState<'single' | 'batch' | 'dish' | null>('single')
  const [rrp, setRrp] = useState<string>('')
  const [status, setStatus] = useState<'draft' | 'confirmed'>('draft')
  const [items, setItems] = useState<RecipeItem[]>([])
  const [allProducts, setAllProducts] = useState<any[]>([])
  const [productSearch, setProductSearch] = useState<Record<number, string>>({})
  const [productSuggestions, setProductSuggestions] = useState<Record<number, any[]>>({})
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Load all products for autocomplete
  useEffect(() => {
    getDocs(collection(db, 'venues', venueId, 'products')).then(snap => {
      setAllProducts(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })))
    }).catch(() => {})
  }, [venueId])

  // Load existing recipe
  useEffect(() => {
    if (!recipeId) {
      setName(''); setCategory(null); setMode('single'); setRrp(''); setStatus('draft'); setItems([])
      return
    }
    getDoc(doc(db, 'venues', venueId, 'recipes', recipeId)).then(snap => {
      if (!snap.exists()) return
      const d = snap.data() as any
      setName(d.name || '')
      setCategory(d.category || null)
      setMode(d.mode || 'single')
      setRrp(d.rrp != null ? String(d.rrp) : '')
      setStatus(d.status || 'draft')
      setItems((d.items || []).map((it: any) => ({
        productId: it.productId ?? null,
        name: it.name || '',
        qty: it.qty || 1,
        unit: it.unit || null,
        costPerUnit: it.costPerUnit ?? null,
        lineTotal: it.lineTotal ?? null,
      })))
    }).catch(() => {})
  }, [venueId, recipeId])

  const computedCogs = items
    .filter(it => it.costPerUnit != null)
    .reduce((s, it) => s + it.qty * (it.costPerUnit ?? 0), 0)
  const hasPartialCosts = items.some(it => it.costPerUnit == null)
  const rrpNum = parseFloat(rrp) || null
  const gpPct = rrpNum && rrpNum > 0 && computedCogs > 0
    ? Math.round(((rrpNum - computedCogs) / rrpNum) * 100)
    : null
  const gpColor = gpPct == null ? '#6b7280' : gpPct >= 70 ? '#16a34a' : gpPct >= 60 ? '#c47b2b' : '#dc2626'

  function updateItem(idx: number, patch: Partial<RecipeItem>) {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, ...patch } : it))
  }

  function addItem() {
    setItems(prev => [...prev, { productId: null, name: '', qty: 1, unit: null, costPerUnit: null, lineTotal: null }])
  }

  function removeItem(idx: number) {
    setItems(prev => prev.filter((_, i) => i !== idx))
    setProductSearch(prev => { const n = { ...prev }; delete n[idx]; return n })
    setProductSuggestions(prev => { const n = { ...prev }; delete n[idx]; return n })
  }

  function handleProductSearchChange(idx: number, val: string) {
    setProductSearch(prev => ({ ...prev, [idx]: val }))
    updateItem(idx, { name: val, productId: null })
    if (val.trim().length > 0) {
      const matches = allProducts.filter(p => (p.name || '').toLowerCase().includes(val.toLowerCase())).slice(0, 5)
      setProductSuggestions(prev => ({ ...prev, [idx]: matches }))
    } else {
      setProductSuggestions(prev => ({ ...prev, [idx]: [] }))
    }
  }

  function selectProduct(idx: number, product: any) {
    updateItem(idx, {
      productId: product.id,
      name: product.name,
      unit: product.unit || null,
      costPerUnit: product.costPrice ?? null,
    })
    setProductSearch(prev => ({ ...prev, [idx]: product.name }))
    setProductSuggestions(prev => ({ ...prev, [idx]: [] }))
  }

  async function handleSave() {
    if (!name.trim()) return
    setSaving(true)
    try {
      const payload: any = {
        name: name.trim(),
        category,
        mode,
        rrp: rrpNum,
        cogs: computedCogs > 0 ? Math.round(computedCogs * 100) / 100 : null,
        status,
        items: items.map(it => ({
          productId: it.productId ?? null,
          name: it.name,
          qty: it.qty,
          unit: it.unit ?? null,
          costPerUnit: it.costPerUnit ?? null,
          lineTotal: it.qty * (it.costPerUnit ?? 0),
        })),
        updatedAt: serverTimestamp(),
      }
      if (recipeId) {
        await updateDoc(doc(db, 'venues', venueId, 'recipes', recipeId), payload)
        onSaved(recipeId)
      } else {
        const newRef = await addDoc(collection(db, 'venues', venueId, 'recipes'), { ...payload, createdAt: serverTimestamp() })
        onSaved(newRef.id)
      }
    } catch (e) {
      console.error('[RecipeEditor] save failed', e)
    }
    setSaving(false)
  }

  async function handleDelete() {
    if (!recipeId) return
    try {
      await deleteDoc(doc(db, 'venues', venueId, 'recipes', recipeId))
      onClose()
    } catch (e) {
      console.error('[RecipeEditor] delete failed', e)
    }
  }

  const CATEGORY_OPTIONS: { value: 'food' | 'beverage'; label: string }[] = [
    { value: 'food', label: '🍽 Food' },
    { value: 'beverage', label: '🍹 Beverage' },
  ]
  const MODE_OPTIONS: { value: 'single' | 'batch' | 'dish'; label: string }[] = [
    { value: 'single', label: 'Per serve' },
    { value: 'batch', label: 'Batch' },
    { value: 'dish', label: 'Dish' },
  ]

  return (
    <div className={styles.editorPanelInner}>
      <button type="button" className={styles.closeEditorBtn} onClick={onClose}>×</button>

      {/* Name */}
      <input
        className={styles.editorName}
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="Recipe name"
      />

      {/* Category chips */}
      <div className={styles.chipRow} style={{ marginBottom: 8 }}>
        {CATEGORY_OPTIONS.map(c => (
          <button key={c.value} type="button"
            className={`${styles.filterChip} ${category === c.value ? styles.filterChipActive : ''}`}
            onClick={() => setCategory(category === c.value ? null : c.value)}
          >{c.label}</button>
        ))}
      </div>

      {/* Mode chips */}
      <div className={styles.chipRow} style={{ marginBottom: 12 }}>
        {MODE_OPTIONS.map(m => (
          <button key={m.value} type="button"
            className={`${styles.filterChip} ${mode === m.value ? styles.filterChipActive : ''}`}
            onClick={() => setMode(m.value)}
          >{m.label}</button>
        ))}
      </div>

      {/* Pricing row */}
      <div className={styles.pricingRow}>
        <span className={styles.computedCogs}>COGS: {computedCogs > 0 ? `$${computedCogs.toFixed(2)}` : '—'}</span>
        <span style={{ color: gpColor, fontWeight: 700 }}>GP: {gpPct != null ? `${gpPct}%` : '—'}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 12, color: '#6b7280' }}>RRP $</span>
          <input
            style={{ width: 70, padding: '4px 8px', border: '1px solid #e5e3de', borderRadius: 6, fontSize: 13 }}
            type="number"
            value={rrp}
            onChange={e => setRrp(e.target.value)}
            placeholder="0.00"
          />
        </div>
      </div>
      {hasPartialCosts && <p className={styles.partialWarning}>⚠️ Some ingredients have no cost price — COGS is incomplete</p>}

      {/* Status toggle */}
      <div className={styles.statusToggle}>
        <button type="button" className={`${styles.statusBtn} ${status === 'draft' ? styles.statusBtnActive : ''}`} onClick={() => setStatus('draft')}>Draft</button>
        <button type="button" className={`${styles.statusBtn} ${status === 'confirmed' ? styles.statusBtnActive : ''}`} onClick={() => setStatus('confirmed')}>Confirmed</button>
      </div>

      {/* Ingredients */}
      <p style={{ fontSize: 13, fontWeight: 700, color: '#0B132B', margin: '16px 0 8px' }}>Ingredients</p>
      {items.map((item, idx) => (
        <div key={idx} className={styles.ingredientRow}>
          <div className={styles.ingredientNameWrap}>
            <input
              className={styles.ingredientNameInput}
              value={productSearch[idx] ?? item.name}
              onChange={e => handleProductSearchChange(idx, e.target.value)}
              placeholder="Product name"
            />
            {(productSuggestions[idx] || []).length > 0 && (
              <div className={styles.ingredientSuggestions}>
                {productSuggestions[idx].map(p => (
                  <div key={p.id} className={styles.ingredientSuggestion} onClick={() => selectProduct(idx, p)}>
                    {p.name}{p.unit ? ` (${p.unit})` : ''}{p.costPrice != null ? ` — $${p.costPrice}` : ''}
                  </div>
                ))}
              </div>
            )}
          </div>
          <input className={styles.smallInput} type="number" value={item.qty} onChange={e => updateItem(idx, { qty: Number(e.target.value) || 1 })} min={0.01} step="any" />
          <input className={styles.smallInput} value={item.unit ?? ''} onChange={e => updateItem(idx, { unit: e.target.value || null })} placeholder="unit" />
          <span className={styles.lineTotal}>{item.costPerUnit != null ? `$${(item.qty * item.costPerUnit).toFixed(2)}` : '—'}</span>
          <button type="button" className={styles.removeIngredient} onClick={() => removeItem(idx)}>×</button>
        </div>
      ))}
      <button type="button" className={styles.addIngredientBtn} onClick={addItem}>+ Add ingredient</button>

      {/* Save */}
      <button type="button" className={styles.saveBtn} onClick={handleSave} disabled={!name.trim() || saving}>
        {saving ? 'Saving…' : recipeId ? 'Save changes' : 'Create recipe'}
      </button>

      {/* Delete */}
      {recipeId && !confirmDelete && (
        <button type="button" className={styles.deleteRecipeBtn} onClick={() => setConfirmDelete(true)}>
          Delete recipe
        </button>
      )}
      {recipeId && confirmDelete && (
        <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: '#dc2626' }}>
          Delete {name} permanently?
          <button style={{ background: '#dc2626', color: '#fff', border: 'none', borderRadius: 4, padding: '4px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }} onClick={handleDelete}>Delete</button>
          <button style={{ background: 'none', border: '1px solid #e5e3de', borderRadius: 4, padding: '4px 10px', fontSize: 12, cursor: 'pointer' }} onClick={() => setConfirmDelete(false)}>Cancel</button>
        </div>
      )}
    </div>
  )
}
