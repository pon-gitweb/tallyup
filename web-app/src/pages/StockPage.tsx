import { useEffect, useMemo, useState } from 'react'
import { collection, getDocs, orderBy, query } from 'firebase/firestore'
import { db } from '../firebase'
import styles from './StockPage.module.css'

// ─── Types ────────────────────────────────────────────────────────────────────

type Row = {
  id: string
  name: string
  category: string | null
  supplierName: string | null
  onHand: number
  costPrice: number | null
  lineValue: number | null
  deptId: string
  deptName: string
}

type UnplacedRow = {
  id: string
  name: string
  category: string | null
  supplierName: string | null
  onHand: number   // = baselineCount
  costPrice: number | null
  lineValue: number | null
}

type SortKey = 'name' | 'category' | 'supplierName' | 'onHand' | 'costPrice' | 'lineValue'
type SortConfig = { key: SortKey; dir: 'asc' | 'desc' }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtCurrency(n: number | null) {
  if (n == null) return '—'
  return '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function fmtQty(n: number) {
  return n % 1 === 0 ? String(n) : n.toFixed(2)
}

function applySort<T extends Record<string, any>>(rows: T[], cfg: SortConfig): T[] {
  return [...rows].sort((a, b) => {
    const av = a[cfg.key] as string | number | null
    const bv = b[cfg.key] as string | number | null
    if (av == null && bv == null) return 0
    if (av == null) return 1
    if (bv == null) return -1
    const cmp = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number)
    return cfg.dir === 'asc' ? cmp : -cmp
  })
}

function exportCsvBlob(
  deptGroups: Map<string, { deptName: string; rows: Row[] }>,
  unplaced: UnplacedRow[],
) {
  const headers = ['Department', 'Product', 'Category', 'Supplier', 'On Hand', 'Unit Cost', 'Line Value']
  const placed = [...deptGroups.entries()].flatMap(([, g]) =>
    g.rows.map(r => [
      g.deptName, r.name, r.category || '', r.supplierName || '',
      fmtQty(r.onHand),
      r.costPrice != null ? r.costPrice.toFixed(2) : '',
      r.lineValue != null ? r.lineValue.toFixed(2) : '',
    ])
  )
  const unpl = unplaced.map(r => [
    'Unplaced', r.name, r.category || '', r.supplierName || '',
    fmtQty(r.onHand),
    r.costPrice != null ? r.costPrice.toFixed(2) : '',
    r.lineValue != null ? r.lineValue.toFixed(2) : '',
  ])
  return [headers, ...placed, ...unpl]
    .map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))
    .join('\n')
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function StockPage({ venueId }: { venueId: string }) {
  const [rows, setRows] = useState<Row[]>([])
  const [unplaced, setUnplaced] = useState<UnplacedRow[]>([])
  const [depts, setDepts] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [textFilter, setTextFilter] = useState('')
  const [deptFilter, setDeptFilter] = useState('all')
  const [sort, setSort] = useState<SortConfig>({ key: 'name', dir: 'asc' })

  useEffect(() => {
    setLoading(true)
    ;(async () => {
      // Products: costPrice fallback + unplaced section (baselinePending === true)
      const productsSnap = await getDocs(collection(db, 'venues', venueId, 'products'))
      const productMap = new Map<string, any>()
      const unplacedList: UnplacedRow[] = []
      productsSnap.docs.forEach(d => {
        const data = d.data() as any
        productMap.set(d.id, data)
        if (data.baselinePending === true) {
          const bc = typeof data.baselineCount === 'number' ? data.baselineCount : 0
          const cp = typeof data.costPrice === 'number' ? data.costPrice : null
          unplacedList.push({
            id: d.id,
            name: data.name || '',
            category: data.category ?? null,
            supplierName: data.supplierName ?? null,
            onHand: bc,
            costPrice: cp,
            lineValue: cp != null ? bc * cp : null,
          })
        }
      })

      // Departments in creation order
      const deptsSnap = await getDocs(
        query(collection(db, 'venues', venueId, 'departments'), orderBy('createdAt', 'asc')),
      )
      const deptList = deptsSnap.docs.map(d => ({
        id: d.id,
        name: (d.data() as any).name || d.id,
      }))

      // Items: aggregate lastCount per product within each department
      const allRows: Row[] = []
      await Promise.all(
        deptsSnap.docs.map(async deptDoc => {
          const deptName = (deptDoc.data() as any).name || deptDoc.id
          const areasSnap = await getDocs(
            collection(db, 'venues', venueId, 'departments', deptDoc.id, 'areas'),
          )
          // Aggregate by productId (or name-key) within this dept
          const agg = new Map<string, Row>()
          await Promise.all(
            areasSnap.docs.map(async areaDoc => {
              const itemsSnap = await getDocs(
                collection(
                  db, 'venues', venueId, 'departments',
                  deptDoc.id, 'areas', areaDoc.id, 'items',
                ),
              )
              itemsSnap.docs.forEach(d => {
                const item = d.data() as any
                if (typeof item.lastCount !== 'number') return
                const key = item.productId || `name:${(item.name || '').toLowerCase()}`
                const prod = item.productId ? productMap.get(item.productId) : null
                const costPrice =
                  typeof item.costPrice === 'number' ? item.costPrice
                  : prod && typeof prod.costPrice === 'number' ? prod.costPrice
                  : null
                const existing = agg.get(key)
                if (existing) {
                  const newOnHand = existing.onHand + item.lastCount
                  agg.set(key, {
                    ...existing,
                    onHand: newOnHand,
                    lineValue: costPrice != null ? newOnHand * costPrice : null,
                  })
                } else {
                  agg.set(key, {
                    id: key,
                    name: item.name || '',
                    category: item.category ?? prod?.category ?? null,
                    supplierName: item.supplierName ?? prod?.supplierName ?? null,
                    onHand: item.lastCount,
                    costPrice,
                    lineValue: costPrice != null ? item.lastCount * costPrice : null,
                    deptId: deptDoc.id,
                    deptName,
                  })
                }
              })
            }),
          )
          agg.forEach(r => allRows.push(r))
        }),
      )

      setDepts(deptList)
      setRows(allRows)
      setUnplaced(unplacedList)
      setLoading(false)
    })().catch(() => setLoading(false))
  }, [venueId])

  function toggleSort(key: SortKey) {
    setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' })
  }

  function si(key: SortKey) {
    return sort.key === key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ' ⇅'
  }

  const needle = textFilter.trim().toLowerCase()

  const filteredRows = useMemo(() => rows.filter(r => {
    if (deptFilter !== 'all' && r.deptId !== deptFilter) return false
    if (needle && !r.name.toLowerCase().includes(needle) &&
        !(r.category || '').toLowerCase().includes(needle) &&
        !(r.supplierName || '').toLowerCase().includes(needle)) return false
    return true
  }), [rows, deptFilter, needle])

  const filteredUnplaced = useMemo(() => {
    if (deptFilter !== 'all') return []
    if (!needle) return unplaced
    return unplaced.filter(r =>
      r.name.toLowerCase().includes(needle) ||
      (r.category || '').toLowerCase().includes(needle) ||
      (r.supplierName || '').toLowerCase().includes(needle),
    )
  }, [unplaced, deptFilter, needle])

  const deptGroups = useMemo(() => {
    const map = new Map<string, { deptName: string; rows: Row[] }>()
    const ids = deptFilter === 'all' ? depts.map(d => d.id) : [deptFilter]
    ids.forEach(id => {
      const group = filteredRows.filter(r => r.deptId === id)
      if (group.length > 0) map.set(id, { deptName: group[0].deptName, rows: applySort(group, sort) })
    })
    return map
  }, [filteredRows, depts, deptFilter, sort])

  const sortedUnplaced = useMemo(() => applySort(filteredUnplaced, sort), [filteredUnplaced, sort])

  const venueTotal = useMemo(() => {
    let t = 0
    filteredRows.forEach(r => { if (r.lineValue != null) t += r.lineValue })
    filteredUnplaced.forEach(r => { if (r.lineValue != null) t += r.lineValue })
    return t
  }, [filteredRows, filteredUnplaced])

  function handleExport() {
    const csv = exportCsvBlob(deptGroups, sortedUnplaced)
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = 'current-stock.csv'
    a.click()
  }

  const thead = (unplacedCol = false) => (
    <thead>
      <tr>
        <th className={styles.th} onClick={() => toggleSort('name')}>Product{si('name')}</th>
        <th className={styles.th} onClick={() => toggleSort('category')}>Category{si('category')}</th>
        <th className={styles.th} onClick={() => toggleSort('supplierName')}>Supplier{si('supplierName')}</th>
        <th className={`${styles.th} ${styles.thRight}`} onClick={() => toggleSort('onHand')}>
          {unplacedCol ? 'Imported Count' : 'On Hand'}{si('onHand')}
        </th>
        <th className={`${styles.th} ${styles.thRight}`} onClick={() => toggleSort('costPrice')}>Unit Cost{si('costPrice')}</th>
        <th className={`${styles.th} ${styles.thRight}`} onClick={() => toggleSort('lineValue')}>Line Value{si('lineValue')}</th>
      </tr>
    </thead>
  )

  function trow(r: Row | UnplacedRow) {
    return (
      <tr key={r.id} className={styles.dataRow}>
        <td className={styles.td}>{r.name}</td>
        <td className={styles.td}><span className={r.category ? undefined : styles.dim}>{r.category || '—'}</span></td>
        <td className={styles.td}><span className={r.supplierName ? undefined : styles.dim}>{r.supplierName || '—'}</span></td>
        <td className={styles.tdNum}>{fmtQty(r.onHand)}</td>
        <td className={styles.tdNum}>{fmtCurrency(r.costPrice)}</td>
        <td className={styles.tdNum}>{fmtCurrency(r.lineValue)}</td>
      </tr>
    )
  }

  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>Current Stock</h1>
      <p className={styles.subhead}>
        Live valuation: last recorded count × unit cost, grouped by department.
        Import a past stocktake to populate instantly; place products into areas to track live.
      </p>

      <div className={styles.toolbar}>
        <div className={styles.filters}>
          <input
            className={styles.filterInput}
            placeholder="Search products…"
            value={textFilter}
            onChange={e => setTextFilter(e.target.value)}
          />
          <select
            className={styles.filterSelect}
            value={deptFilter}
            onChange={e => setDeptFilter(e.target.value)}
          >
            <option value="all">All departments</option>
            {depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <button className={styles.exportBtn} onClick={handleExport}>Export CSV</button>
      </div>

      {loading ? (
        <p className={styles.loading}>Loading…</p>
      ) : (
        <>
          {[...deptGroups.entries()].map(([deptId, group]) => {
            const deptTotal = group.rows.reduce((s, r) => s + (r.lineValue ?? 0), 0)
            return (
              <div key={deptId} className={styles.section}>
                <div className={styles.sectionHeader}>
                  <span className={styles.sectionName}>{group.deptName}</span>
                  <span className={styles.sectionTotal}>{fmtCurrency(deptTotal)}</span>
                </div>
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    {thead()}
                    <tbody>{group.rows.map(trow)}</tbody>
                  </table>
                </div>
              </div>
            )
          })}

          {sortedUnplaced.length > 0 && (
            <div className={styles.section}>
              <div className={`${styles.sectionHeader} ${styles.sectionHeaderUnplaced}`}>
                <span className={styles.sectionName}>
                  Unplaced
                  <span className={styles.sectionSub}> · imported, not yet assigned to an area</span>
                </span>
                <span className={styles.sectionTotal}>
                  {fmtCurrency(sortedUnplaced.reduce((s, r) => s + (r.lineValue ?? 0), 0))}
                </span>
              </div>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  {thead(true)}
                  <tbody>{sortedUnplaced.map(trow)}</tbody>
                </table>
              </div>
            </div>
          )}

          {deptGroups.size === 0 && sortedUnplaced.length === 0 && (
            <p className={styles.empty}>
              No stock data yet. Import a past stocktake (Zone A) or run a first count on mobile.
            </p>
          )}

          <div className={styles.venueTotalRow}>
            <span className={styles.venueTotalLabel}>Venue total</span>
            <span className={styles.venueTotalValue}>{fmtCurrency(venueTotal)}</span>
          </div>
        </>
      )}
    </div>
  )
}
