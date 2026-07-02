import { useEffect, useMemo, useState } from 'react'
import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore'
import {
  BarChart, Bar, Cell, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { db } from '../firebase'
import { theme } from '../theme'
import styles from './ReportsPage.module.css'

// ─── Types ────────────────────────────────────────────────────────────────────

type VarianceRow = {
  productId: string
  name: string
  deptName: string
  areaName: string
  expectedQty: number | null
  actualQty: number
  varianceUnits: number
  varianceDollars: number | null
  costPrice: number | null
}

type CycleRow = {
  deptId: string
  deptName: string
  cycleNumber: number
  completedAt: Date | null
  itemsCounted: number
  totalStockValue: number | null
  totalVarianceDollars: number | null
  durationMinutes: number | null
}

type PriceChangeRow = {
  id: string
  productName: string
  supplierName: string | null
  oldPrice: number | null
  newPrice: number | null
  detectedAt: Date | null
  status: string
}

type DeptSummary = {
  deptId: string
  deptName: string
  hasData: boolean
  cycleNumber: number | null
  completedAt: Date | null
  itemsCounted: number
  totalStockValue: number | null
  totalVarianceDollars: number | null
}

type SortConfig<K extends string> = { key: K; dir: 'asc' | 'desc' }
type VarianceSortKey = keyof VarianceRow

// ─── Helpers ──────────────────────────────────────────────────────────────────

function truncate(s: string, len: number): string {
  return s.length > len ? s.slice(0, len) + '…' : s
}

function fmtMoney(v: number | null): string {
  if (v == null) return '—'
  const abs = Math.abs(v)
  const sign = v < 0 ? '-' : ''
  if (abs === 0) return '$0'
  if (abs >= 100) return sign + '$' + Math.round(abs).toLocaleString('en-NZ')
  return sign + '$' + abs.toFixed(1)
}

function fmtDate(d: Date | null): string {
  if (!d) return '—'
  return d.toLocaleDateString('en-NZ', { day: '2-digit', month: 'short', year: 'numeric' })
}

function fmtDuration(mins: number | null | undefined): string {
  if (mins == null) return '—'
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h === 0) return `${m}m`
  return `${h}h ${m}m`
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

function escCsv(v: unknown): string {
  const s = String(v ?? '')
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g, '""')}"`
    : s
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ReportsPage({ venueId }: { venueId: string }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const [deptSummaries, setDeptSummaries] = useState<DeptSummary[]>([])
  const [varianceRows, setVarianceRows] = useState<VarianceRow[]>([])
  const [historyRows, setHistoryRows] = useState<CycleRow[]>([])
  const [priceRows, setPriceRows] = useState<PriceChangeRow[]>([])

  const [varianceSort, setVarianceSort] = useState<SortConfig<VarianceSortKey>>({
    key: 'varianceDollars',
    dir: 'desc',
  })
  const [varianceFilter, setVarianceFilter] = useState<'all' | 'shortages' | 'excesses'>('all')

  useEffect(() => {
    loadReports()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venueId])

  async function loadReports() {
    setLoading(true)
    setError(false)
    try {
      const [deptsSnap, flagsSnap] = await Promise.all([
        getDocs(collection(db, 'venues', venueId, 'departments')),
        getDocs(collection(db, 'venues', venueId, 'priceChangeFlags')),
      ])

      const summaries: DeptSummary[] = []
      const varRows: VarianceRow[] = []
      const histRows: CycleRow[] = []

      await Promise.all(
        deptsSnap.docs.map(async (deptDoc) => {
          const deptName = (deptDoc.data() as any).name || deptDoc.id

          const snapsSnap = await getDocs(
            query(
              collection(db, 'venues', venueId, 'departments', deptDoc.id, 'snapshots'),
              orderBy('cycleNumber', 'desc'),
              limit(20),
            ),
          )

          if (snapsSnap.empty) {
            summaries.push({
              deptId: deptDoc.id,
              deptName,
              hasData: false,
              cycleNumber: null,
              completedAt: null,
              itemsCounted: 0,
              totalStockValue: null,
              totalVarianceDollars: null,
            })
            return
          }

          // Latest snapshot → summary card + variance rows
          const latestData = snapsSnap.docs[0].data() as any
          summaries.push({
            deptId: deptDoc.id,
            deptName,
            hasData: true,
            cycleNumber: latestData.cycleNumber ?? 1,
            completedAt: latestData.completedAt?.toDate?.() ?? null,
            itemsCounted: latestData.summary?.totalItemsCounted ?? 0,
            totalStockValue: latestData.summary?.totalStockValue ?? null,
            totalVarianceDollars: latestData.summary?.totalVarianceDollars ?? null,
          })

          for (const item of (latestData.items || []) as any[]) {
            const varianceUnits: number = item.totalVarianceQty ?? 0
            if (varianceUnits === 0) continue
            varRows.push({
              productId: item.productId || item.name,
              name: item.name || '—',
              deptName,
              areaName: item.areaName || '—',
              expectedQty: item.openingCount ?? null,
              actualQty: item.actualClosing ?? 0,
              varianceUnits,
              varianceDollars: item.totalVarianceDollars ?? null,
              costPrice: item.costPrice ?? null,
            })
          }

          // All snapshots → history rows
          for (const snapDoc of snapsSnap.docs) {
            const sd = snapDoc.data() as any
            histRows.push({
              deptId: deptDoc.id,
              deptName,
              cycleNumber: sd.cycleNumber ?? 1,
              completedAt: sd.completedAt?.toDate?.() ?? null,
              itemsCounted: sd.summary?.totalItemsCounted ?? 0,
              totalStockValue: sd.summary?.totalStockValue ?? null,
              totalVarianceDollars: sd.summary?.totalVarianceDollars ?? null,
              durationMinutes: sd.durationMinutes ?? null,
            })
          }
        }),
      )

      const pRows: PriceChangeRow[] = flagsSnap.docs.map((d) => {
        const data = d.data() as any
        return {
          id: d.id,
          productName: data.productName || '—',
          supplierName: data.supplierName ?? null,
          oldPrice: data.oldPrice ?? null,
          newPrice: data.newPrice ?? null,
          detectedAt: data.detectedAt?.toDate?.() ?? null,
          status: data.status || 'pending',
        }
      })

      summaries.sort((a, b) => a.deptName.localeCompare(b.deptName))
      histRows.sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0))
      pRows.sort((a, b) => {
        if (a.status === 'pending' && b.status !== 'pending') return -1
        if (b.status === 'pending' && a.status !== 'pending') return 1
        return (b.detectedAt?.getTime() ?? 0) - (a.detectedAt?.getTime() ?? 0)
      })

      setDeptSummaries(summaries)
      setVarianceRows(varRows)
      setHistoryRows(histRows)
      setPriceRows(pRows)
    } catch (e) {
      console.error('[ReportsPage]', e)
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  // ── Chart A: variance trend ──────────────────────────────────────────────────
  const trendData = useMemo(() => {
    const byLabel: Record<string, { cycleNum: number; date: Date | null; variance: number }> = {}
    for (const row of historyRows) {
      if (row.totalVarianceDollars == null) continue
      const key = String(row.cycleNumber)
      if (!byLabel[key]) byLabel[key] = { cycleNum: row.cycleNumber, date: row.completedAt, variance: 0 }
      byLabel[key].variance += Math.abs(row.totalVarianceDollars)
    }
    return Object.values(byLabel)
      .sort((a, b) => a.cycleNum - b.cycleNum)
      .map((d) => ({
        label: `S${d.cycleNum}`,
        fullLabel: `Stocktake ${d.cycleNum}${d.date ? ' · ' + fmtDate(d.date) : ''}`,
        variance: d.variance,
      }))
  }, [historyRows])

  const trendLineColor =
    trendData.length >= 2 && trendData[trendData.length - 1].variance > trendData[trendData.length - 2].variance
      ? theme.error
      : theme.success

  // ── Chart B: top variance drivers ─────────────────────────────────────────
  const topDrivers = useMemo(() =>
    varianceRows
      .filter((r) => r.varianceDollars != null)
      .sort((a, b) => Math.abs(b.varianceDollars!) - Math.abs(a.varianceDollars!))
      .slice(0, 10)
      .map((r) => ({
        name: truncate(r.name, 15),
        fullName: r.name,
        value: Math.abs(r.varianceDollars!),
        shortage: r.varianceDollars! < 0,
      })),
  [varianceRows])

  const tooltipStyle = { background: '#fff', border: '1px solid #e5e3de', borderRadius: 6, fontSize: 12 }
  const fmtAxis = (v: number) => v >= 1000 ? `$${Math.round(v / 1000)}k` : `$${v}`

  // Sorted + filtered variance rows
  const filteredVariance = useMemo(() => {
    let rows = varianceRows
    if (varianceFilter === 'shortages') rows = rows.filter((r) => r.varianceUnits < 0)
    else if (varianceFilter === 'excesses') rows = rows.filter((r) => r.varianceUnits > 0)

    return [...rows].sort((a, b) => {
      const { key, dir } = varianceSort
      const av = a[key] as number | string | null
      const bv = b[key] as number | string | null

      // Default sort on varianceDollars: by absolute value
      if (key === 'varianceDollars') {
        const aabs = Math.abs((av as number | null) ?? 0)
        const babs = Math.abs((bv as number | null) ?? 0)
        return dir === 'desc' ? babs - aabs : aabs - babs
      }

      if (av == null) return 1
      if (bv == null) return -1
      if (typeof av === 'number' && typeof bv === 'number') {
        return dir === 'desc' ? bv - av : av - bv
      }
      return dir === 'desc'
        ? String(bv).localeCompare(String(av))
        : String(av).localeCompare(String(bv))
    })
  }, [varianceRows, varianceFilter, varianceSort])

  function toggleSort(key: VarianceSortKey) {
    setVarianceSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' },
    )
  }

  function sortMark(key: VarianceSortKey) {
    if (varianceSort.key !== key) return ''
    return varianceSort.dir === 'asc' ? ' ▲' : ' ▼'
  }

  function exportVarianceCsv() {
    const dateStr = new Date().toISOString().slice(0, 10)
    let csv = 'Product,Department,Area,Expected,Counted,Variance (units),Variance ($)\n'
    for (const r of filteredVariance) {
      csv +=
        [
          escCsv(r.name),
          escCsv(r.deptName),
          escCsv(r.areaName),
          r.expectedQty ?? '',
          r.actualQty,
          r.varianceUnits,
          r.varianceDollars != null ? r.varianceDollars.toFixed(2) : '',
        ].join(',') + '\n'
    }
    downloadCsv(`variance-${dateStr}.csv`, csv)
  }

  function exportHistoryCsv() {
    const dateStr = new Date().toISOString().slice(0, 10)
    let csv = 'Date,Department,Stocktake,Items counted,Stock value,Variance ($),Duration (mins)\n'
    for (const r of historyRows) {
      csv +=
        [
          escCsv(fmtDate(r.completedAt)),
          escCsv(r.deptName),
          r.cycleNumber,
          r.itemsCounted,
          r.totalStockValue != null ? r.totalStockValue.toFixed(2) : '',
          r.totalVarianceDollars != null ? r.totalVarianceDollars.toFixed(2) : '',
          r.durationMinutes ?? '',
        ].join(',') + '\n'
    }
    downloadCsv(`stocktake-history-${dateStr}.csv`, csv)
  }

  if (loading) return <p className={styles.loading}>Loading reports…</p>
  if (error)
    return (
      <p className={styles.errorText}>Could not load report data. Please try again.</p>
    )

  const VARIANCE_COLS: { key: VarianceSortKey; label: string }[] = [
    { key: 'name', label: 'Product' },
    { key: 'deptName', label: 'Dept' },
    { key: 'areaName', label: 'Area' },
    { key: 'expectedQty', label: 'Expected' },
    { key: 'actualQty', label: 'Counted' },
    { key: 'varianceUnits', label: 'Variance (units)' },
    { key: 'varianceDollars', label: 'Variance ($)' },
  ]

  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>Reports</h1>
      <p className={styles.subhead}>Stocktake variance, history, and price changes for your venue.</p>

      {/* ── SECTION 1: Variance Summary ── */}
      <section className={styles.section}>
        <h2 className={styles.sectionHeading}>Variance Summary</h2>
        <p className={styles.sectionSubhead}>Latest stocktake results by department.</p>
        <div className={styles.cardRow}>
          {deptSummaries.map((dept) =>
            !dept.hasData ? (
              <div key={dept.deptId} className={`${styles.card} ${styles.cardEmpty}`}>
                <p className={styles.cardName}>{dept.deptName}</p>
                <p className={styles.cardNoData}>No stocktake data yet</p>
              </div>
            ) : (
              <div key={dept.deptId} className={styles.card}>
                <p className={styles.cardName}>{dept.deptName}</p>
                <p className={styles.cardDate}>
                  {fmtDate(dept.completedAt)} · Stocktake {dept.cycleNumber}
                </p>
                <p className={styles.cardMeta}>{dept.itemsCounted} items counted</p>
                {dept.totalStockValue != null && (
                  <p className={styles.cardValue}>{fmtMoney(dept.totalStockValue)} stock value</p>
                )}
                {dept.totalVarianceDollars != null ? (
                  <p
                    className={styles.cardVariance}
                    style={{
                      color:
                        dept.totalVarianceDollars < 0
                          ? theme.error
                          : dept.totalVarianceDollars > 0
                            ? theme.success
                            : theme.slateMid,
                    }}
                  >
                    {dept.totalVarianceDollars < 0
                      ? '▼'
                      : dept.totalVarianceDollars > 0
                        ? '▲'
                        : '●'}{' '}
                    {fmtMoney(dept.totalVarianceDollars)} variance
                  </p>
                ) : (
                  <p className={styles.cardNoData}>Add cost prices to see variance</p>
                )}
              </div>
            ),
          )}
        </div>
      </section>

      {/* ── CHARTS ── */}
      <div className={styles.chartRow}>
        {/* Chart A — Variance trend */}
        <div className={styles.chartCard}>
          <p className={styles.chartTitle}>Variance trend</p>
          {trendData.length < 2 ? (
            <p className={styles.chartEmpty}>Complete another stocktake to see your variance trend.</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={trendData} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e3de" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={fmtAxis} tick={{ fontSize: 11 }} width={56} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={((v: number) => [`$${Math.round(v).toLocaleString('en-NZ')}`, 'Variance']) as any}
                  labelFormatter={((label: string) => trendData.find((d) => d.label === label)?.fullLabel ?? label) as any}
                />
                <Line type="monotone" dataKey="variance" stroke={trendLineColor} strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Chart B — Top variance drivers */}
        <div className={styles.chartCard}>
          <p className={styles.chartTitle}>Top variance drivers</p>
          {topDrivers.length === 0 ? (
            <p className={styles.chartEmpty}>Add cost prices to products to see dollar impact.</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={topDrivers} layout="vertical" margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e3de" horizontal={false} />
                <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11 }} />
                <XAxis type="number" tickFormatter={fmtAxis} tick={{ fontSize: 11 }} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={((v: number) => [`$${Math.round(v).toLocaleString('en-NZ')}`, 'Variance']) as any}
                  labelFormatter={((_: string, payload: any[]) => payload?.[0]?.payload?.fullName ?? '') as any}
                />
                <Bar dataKey="value">
                  {topDrivers.map((entry, i) => (
                    <Cell key={i} fill={entry.shortage ? theme.error : theme.success} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* ── SECTION 2: Variance Detail ── */}
      <section className={styles.section}>
        <h2 className={styles.sectionHeading}>Variance Detail</h2>
        <p className={styles.sectionSubhead}>
          Items with non-zero variance from your most recent stocktake, sorted by dollar impact.
        </p>
        <div className={styles.sectionToolbar}>
          <div className={styles.filterGroup}>
            {(['all', 'shortages', 'excesses'] as const).map((f) => (
              <button
                key={f}
                type="button"
                className={`${styles.filterBtn} ${varianceFilter === f ? styles.filterBtnActive : ''}`}
                onClick={() => setVarianceFilter(f)}
              >
                {f === 'all' ? 'All' : f === 'shortages' ? 'Shortages only' : 'Excesses only'}
              </button>
            ))}
          </div>
          <button type="button" className={styles.exportBtn} onClick={exportVarianceCsv}>
            Export CSV
          </button>
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                {VARIANCE_COLS.map((col) => (
                  <th
                    key={col.key}
                    className={styles.thSortable}
                    onClick={() => toggleSort(col.key)}
                  >
                    {col.label}
                    {sortMark(col.key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredVariance.length === 0 ? (
                <tr>
                  <td colSpan={7} className={styles.emptyCell}>
                    No variance items found.
                  </td>
                </tr>
              ) : (
                filteredVariance.map((r, i) => (
                  <tr key={`${r.productId}-${i}`} className={styles.dataRow}>
                    <td className={styles.td}>{r.name}</td>
                    <td className={styles.td}>{r.deptName}</td>
                    <td className={styles.td}>{r.areaName}</td>
                    <td className={styles.tdNum}>{r.expectedQty ?? '—'}</td>
                    <td className={styles.tdNum}>{r.actualQty}</td>
                    <td
                      className={styles.tdNum}
                      style={{ color: r.varianceUnits < 0 ? theme.error : theme.success }}
                    >
                      {r.varianceUnits > 0 ? '+' : ''}
                      {r.varianceUnits}
                    </td>
                    <td
                      className={styles.tdNum}
                      style={{
                        color:
                          r.varianceDollars == null
                            ? theme.slateMid
                            : r.varianceDollars < 0
                              ? theme.error
                              : theme.success,
                        fontWeight: 600,
                      }}
                    >
                      {r.varianceDollars == null
                        ? '—'
                        : (r.varianceDollars > 0 ? '+' : '') + fmtMoney(r.varianceDollars)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── SECTION 3: Stocktake History ── */}
      <section className={styles.section}>
        <h2 className={styles.sectionHeading}>Stocktake History</h2>
        <p className={styles.sectionSubhead}>All completed stocktakes across all departments.</p>
        <div className={styles.sectionToolbar}>
          <div />
          <button type="button" className={styles.exportBtn} onClick={exportHistoryCsv}>
            Export CSV
          </button>
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Date</th>
                <th>Department</th>
                <th>Stocktake</th>
                <th>Items counted</th>
                <th>Stock value</th>
                <th>Variance ($)</th>
                <th>Duration</th>
              </tr>
            </thead>
            <tbody>
              {historyRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className={styles.emptyCell}>
                    No stocktake history yet.
                  </td>
                </tr>
              ) : (
                historyRows.map((r, i) => (
                  <tr key={`${r.deptId}-${r.cycleNumber}-${i}`} className={styles.dataRow}>
                    <td className={styles.td}>{fmtDate(r.completedAt)}</td>
                    <td className={styles.td}>{r.deptName}</td>
                    <td className={styles.tdNum}>Stocktake {r.cycleNumber}</td>
                    <td className={styles.tdNum}>{r.itemsCounted}</td>
                    <td className={styles.tdNum}>{fmtMoney(r.totalStockValue)}</td>
                    <td
                      className={styles.tdNum}
                      style={{
                        color:
                          r.totalVarianceDollars == null
                            ? theme.slateMid
                            : r.totalVarianceDollars < 0
                              ? theme.error
                              : r.totalVarianceDollars > 0
                                ? theme.success
                                : theme.slateMid,
                      }}
                    >
                      {fmtMoney(r.totalVarianceDollars)}
                    </td>
                    <td className={styles.td}>{fmtDuration(r.durationMinutes)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── SECTION 4: Price Changes ── */}
      <section className={styles.section}>
        <h2 className={styles.sectionHeading}>Price Changes</h2>
        <p className={styles.sectionSubhead}>
          Automatically flagged when invoice prices differ from recorded product prices.
        </p>
        {priceRows.length === 0 ? (
          <p className={styles.emptyState}>
            No price changes detected. Price changes are flagged automatically when invoice prices
            differ from recorded product prices.
          </p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Supplier</th>
                  <th>Old price</th>
                  <th>New price</th>
                  <th>Change %</th>
                  <th>Detected</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {priceRows.map((r) => {
                  const changePct =
                    r.oldPrice != null && r.newPrice != null && r.oldPrice > 0
                      ? ((r.newPrice - r.oldPrice) / r.oldPrice) * 100
                      : null
                  const isDecrease = changePct != null && changePct < 0
                  return (
                    <tr key={r.id} className={styles.dataRow}>
                      <td className={styles.td}>{r.productName}</td>
                      <td className={styles.td}>{r.supplierName ?? '—'}</td>
                      <td className={styles.tdNum}>{fmtMoney(r.oldPrice)}</td>
                      <td className={styles.tdNum}>{fmtMoney(r.newPrice)}</td>
                      <td
                        className={styles.tdNum}
                        style={{
                          color:
                            changePct == null
                              ? theme.slateMid
                              : isDecrease
                                ? theme.success
                                : theme.error,
                          fontWeight: 600,
                        }}
                      >
                        {changePct == null
                          ? '—'
                          : (changePct > 0 ? '+' : '') + changePct.toFixed(1) + '%'}
                      </td>
                      <td className={styles.td}>{fmtDate(r.detectedAt)}</td>
                      <td className={styles.td}>
                        <span
                          className={`${styles.badge} ${r.status === 'pending' ? styles.badgePending : styles.badgeAck}`}
                        >
                          {r.status}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
