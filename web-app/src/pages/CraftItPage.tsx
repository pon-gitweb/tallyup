import { Fragment, useEffect, useMemo, useState } from 'react'
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore'
import { db } from '../firebase'
import { theme } from '../theme'
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

  function handleRowClick(id: string) {
    setExpandedId((prev) => (prev === id ? null : id))
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
    <div className={styles.page}>
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
                      <tr className={styles.dataRow} onClick={() => handleRowClick(recipe.id)}>
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
  )
}
