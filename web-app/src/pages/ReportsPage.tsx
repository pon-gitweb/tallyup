import { useEffect, useMemo, useState } from 'react'
import { collection, doc, getDoc, getDocs, limit, orderBy, query } from 'firebase/firestore'
import {
  BarChart, Bar, Cell, LabelList, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { db } from '../firebase'
import { theme } from '../theme'
import {
  CHART_TOOLTIP_STYLE, CHART_GRID_PROPS, CHART_AXIS_TICK, CHART_DOT,
  CHART_ACTIVE_DOT, CHART_ANIMATION, CHART_HEIGHT_LINE, CHART_HEIGHT_BAR,
} from '../chartConfig'
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

  type ReportTab = 'summary' | 'cycle-detail' | 'analysis'
  const [activeTab, setActiveTab] = useState<ReportTab>('summary')

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

      {/* ── TAB BAR ── */}
      <div className={styles.tabBar}>
        {(['summary', 'cycle-detail', 'analysis'] as ReportTab[]).map(tab => (
          <button
            key={tab}
            type="button"
            className={`${styles.tab} ${activeTab === tab ? styles.tabActive : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab === 'summary' ? 'Summary' : tab === 'cycle-detail' ? 'Cycle Detail' : 'Analysis'}
          </button>
        ))}
        <button type="button" className={styles.printBtn} onClick={() => window.print()}>
          🖨 Print
        </button>
      </div>

      {activeTab === 'summary' && (
        <div className={styles.tabSection}>
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
                <ResponsiveContainer width="100%" height={CHART_HEIGHT_LINE}>
                  <LineChart data={trendData} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                    <CartesianGrid {...CHART_GRID_PROPS} />
                    <XAxis dataKey="label" tick={CHART_AXIS_TICK} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={fmtAxis} tick={CHART_AXIS_TICK} width={56} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={CHART_TOOLTIP_STYLE}
                      formatter={((v: number) => [`$${Math.round(v).toLocaleString('en-NZ')}`, 'Variance']) as any}
                      labelFormatter={((label: string) => trendData.find((d) => d.label === label)?.fullLabel ?? label) as any}
                      cursor={{ stroke: theme.border, strokeWidth: 1 }} />
                    <Line type="monotone" dataKey="variance" stroke={trendLineColor} strokeWidth={2.5}
                      dot={CHART_DOT} activeDot={{ ...CHART_ACTIVE_DOT, fill: trendLineColor }} {...CHART_ANIMATION} />
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
                <ResponsiveContainer width="100%" height={CHART_HEIGHT_BAR}>
                  <BarChart data={topDrivers} layout="vertical" margin={{ top: 4, right: 48, left: 0, bottom: 0 }}>
                    <CartesianGrid {...CHART_GRID_PROPS} horizontal={false} vertical={false} />
                    <YAxis type="category" dataKey="name" width={120} tick={CHART_AXIS_TICK} axisLine={false} tickLine={false} />
                    <XAxis type="number" tickFormatter={fmtAxis} tick={CHART_AXIS_TICK} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={CHART_TOOLTIP_STYLE}
                      formatter={((v: number) => [`$${Math.round(v).toLocaleString('en-NZ')}`, 'Variance']) as any}
                      labelFormatter={((_: string, payload: any[]) => payload?.[0]?.payload?.fullName ?? '') as any}
                      cursor={{ fill: 'rgba(11,19,43,0.03)' }} />
                    <Bar dataKey="value" radius={[0, 4, 4, 0]} {...CHART_ANIMATION}>
                      {topDrivers.map((entry, i) => (
                        <Cell key={i} fill={entry.shortage ? theme.error : theme.success} />
                      ))}
                      <LabelList dataKey="value" position="right" fontSize={11}
                        formatter={((v: number) => `$${Math.round(v).toLocaleString('en-NZ')}`) as any}
                        style={{ fill: theme.slateMid, fontFamily: theme.fontBody }} />
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
      )}

      {activeTab === 'cycle-detail' && (
        <div className={styles.tabSection}>
          <CycleDetailTab venueId={venueId} depts={deptSummaries} historyRows={historyRows} />
        </div>
      )}
      {activeTab === 'analysis' && (
        <div className={styles.tabSection}>
          <AnalysisTab venueId={venueId} />
        </div>
      )}
    </div>
  )
}

// ─── CycleDetailTab ───────────────────────────────────────────────────────────

function CycleDetailTab({ venueId, depts, historyRows }: {
  venueId: string
  depts: DeptSummary[]
  historyRows: CycleRow[]
}) {
  const [selectedDeptId, setSelectedDeptId] = useState<string>(depts[0]?.deptId ?? '')
  const [selectedCycle, setSelectedCycle] = useState<string>('')
  const [items, setItems] = useState<any[]>([])
  const [loadingItems, setLoadingItems] = useState(false)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'shortages' | 'excesses' | 'none'>('all')
  const [sortKey, setSortKey] = useState<'varianceDollars' | 'varianceUnits' | 'name'>('varianceDollars')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [compareMode, setCompareMode] = useState(false)
  const [compareDeptId, setCompareDeptId] = useState<string>('')
  const [compareCycle, setCompareCycle] = useState<string>('')
  const [compareItems, setCompareItems] = useState<any[]>([])

  // Load primary items when selection changes
  useEffect(() => {
    if (!selectedDeptId || !selectedCycle) return
    setLoadingItems(true)
    getDoc(doc(db, 'venues', venueId, 'departments', selectedDeptId, 'snapshots', selectedCycle))
      .then(snap => {
        setItems(snap.exists() ? ((snap.data() as any).items || []) : [])
        setLoadingItems(false)
      })
      .catch(() => setLoadingItems(false))
  }, [venueId, selectedDeptId, selectedCycle])

  // Load compare items
  useEffect(() => {
    if (!compareMode || !compareDeptId || !compareCycle) { setCompareItems([]); return }
    getDoc(doc(db, 'venues', venueId, 'departments', compareDeptId, 'snapshots', compareCycle))
      .then(snap => { setCompareItems(snap.exists() ? ((snap.data() as any).items || []) : []) })
      .catch(() => setCompareItems([]))
  }, [venueId, compareDeptId, compareCycle, compareMode])

  const deptCycles = useMemo(() =>
    historyRows.filter(r => r.deptId === selectedDeptId).sort((a, b) => b.cycleNumber - a.cycleNumber),
    [historyRows, selectedDeptId])

  const compareDeptCycles = useMemo(() =>
    historyRows.filter(r => r.deptId === (compareDeptId || selectedDeptId)).sort((a, b) => b.cycleNumber - a.cycleNumber),
    [historyRows, compareDeptId, selectedDeptId])

  function fmtDateLocal(d: Date | null) {
    if (!d) return ''
    return d.toLocaleDateString('en-NZ', { day: '2-digit', month: 'short', year: 'numeric' })
  }

  const visibleItems = useMemo(() => {
    let rows = items
    const needle = search.trim().toLowerCase()
    if (needle) rows = rows.filter((r: any) => (r.name || '').toLowerCase().includes(needle))
    if (filter === 'shortages') rows = rows.filter((r: any) => (r.totalVarianceQty ?? 0) < 0)
    else if (filter === 'excesses') rows = rows.filter((r: any) => (r.totalVarianceQty ?? 0) > 0)
    else if (filter === 'none') rows = rows.filter((r: any) => (r.totalVarianceQty ?? 0) === 0)
    return [...rows].sort((a: any, b: any) => {
      const av = sortKey === 'name' ? (a.name || '') : (Math.abs(a[sortKey] ?? 0))
      const bv = sortKey === 'name' ? (b.name || '') : (Math.abs(b[sortKey] ?? 0))
      if (av < bv) return sortDir === 'asc' ? -1 : 1
      if (av > bv) return sortDir === 'asc' ? 1 : -1
      return 0
    })
  }, [items, search, filter, sortKey, sortDir])

  function toggleSort(key: typeof sortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  function exportCsv() {
    const deptName = depts.find(d => d.deptId === selectedDeptId)?.deptName ?? 'dept'
    const dateStr = new Date().toISOString().slice(0, 10)
    let csv = 'Product,Area,Expected,Actual,Variance Units,Variance Dollars,Cost Price\n'
    for (const r of visibleItems) {
      csv += [r.name, r.areaName, r.openingCount ?? '', r.actualClosing ?? '', r.totalVarianceQty ?? '', r.totalVarianceDollars ?? '', r.costPrice ?? ''].map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',') + '\n'
    }
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `cycle-detail-${deptName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${dateStr}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Compare map: name -> compareItem
  const compareMap = useMemo(() => {
    const m = new Map<string, any>()
    compareItems.forEach((it: any) => { if (it.name) m.set(it.name, it) })
    return m
  }, [compareItems])

  return (
    <div>
      {/* Selector row */}
      <div className={styles.selectorRow}>
        <select
          className={styles.deptSelect}
          value={selectedDeptId}
          onChange={e => { setSelectedDeptId(e.target.value); setSelectedCycle('') }}
        >
          {depts.map(d => <option key={d.deptId} value={d.deptId}>{d.deptName}</option>)}
        </select>
        <select
          className={styles.cycleSelect}
          value={selectedCycle}
          onChange={e => setSelectedCycle(e.target.value)}
          disabled={!selectedDeptId || deptCycles.length === 0}
        >
          <option value="">Select stocktake…</option>
          {deptCycles.map(c => (
            <option key={c.deptId + c.cycleNumber} value={`cycle-${c.cycleNumber}`}>
              Stocktake {c.cycleNumber}{c.completedAt ? ` — ${fmtDateLocal(c.completedAt)}` : ''}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={`${styles.compareToggle} ${compareMode ? styles.compareToggleActive : ''}`}
          onClick={() => setCompareMode(v => !v)}
        >
          ⚖️ {compareMode ? 'Cancel compare' : 'Compare cycles'}
        </button>
      </div>

      {/* Compare selector row */}
      {compareMode && (
        <div className={styles.selectorRow}>
          <select
            className={styles.deptSelect}
            value={compareDeptId || selectedDeptId}
            onChange={e => setCompareDeptId(e.target.value)}
          >
            {depts.map(d => <option key={d.deptId} value={d.deptId}>{d.deptName}</option>)}
          </select>
          <select
            className={styles.cycleSelect}
            value={compareCycle}
            onChange={e => setCompareCycle(e.target.value)}
          >
            <option value="">Compare stocktake…</option>
            {compareDeptCycles.map(c => (
              <option key={c.deptId + c.cycleNumber} value={`cycle-${c.cycleNumber}`}>
                Stocktake {c.cycleNumber}{c.completedAt ? ` — ${fmtDateLocal(c.completedAt)}` : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      {!selectedDeptId || !selectedCycle ? (
        <p className={styles.chartEmpty}>Select a department and stocktake above to see the full item breakdown.</p>
      ) : loadingItems ? (
        <p className={styles.loading}>Loading items…</p>
      ) : (
        <>
          {/* Toolbar */}
          <div className={styles.sectionToolbar}>
            <input
              className={styles.deptSelect}
              style={{ minWidth: 200 }}
              placeholder="Search products…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <div style={{ display: 'flex', gap: 6 }}>
              {(['all', 'shortages', 'excesses', 'none'] as const).map(f => (
                <button
                  key={f}
                  type="button"
                  className={`${styles.filterBtn} ${filter === f ? styles.filterBtnActive : ''}`}
                  onClick={() => setFilter(f)}
                >
                  {f === 'all' ? 'All' : f === 'shortages' ? 'Shortages' : f === 'excesses' ? 'Excesses' : 'No variance'}
                </button>
              ))}
            </div>
            <button type="button" className={styles.exportBtn} onClick={exportCsv}>Export CSV</button>
          </div>

          {/* Main table */}
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.thSortable} onClick={() => toggleSort('name')}>Product{sortKey === 'name' ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}</th>
                  <th>Area</th>
                  <th>Expected</th>
                  <th>Actual</th>
                  <th className={styles.thSortable} onClick={() => toggleSort('varianceUnits')}>Var (units){sortKey === 'varianceUnits' ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}</th>
                  <th className={styles.thSortable} onClick={() => toggleSort('varianceDollars')}>Var ($){sortKey === 'varianceDollars' ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}</th>
                  <th>Cost</th>
                  {compareMode && compareItems.length > 0 && <th>Compare</th>}
                </tr>
              </thead>
              <tbody>
                {visibleItems.map((r: any, i: number) => {
                  const vUnits = r.totalVarianceQty ?? 0
                  const vDollars = r.totalVarianceDollars
                  const unitColor = vUnits < 0 ? theme.error : vUnits > 0 ? theme.success : theme.slateMid
                  const dollarColor = vDollars == null ? theme.slateMid : vDollars < 0 ? theme.error : vDollars > 0 ? theme.success : theme.slateMid
                  const compareItem = compareMap.get(r.name)
                  return (
                    <tr key={i} className={styles.dataRow}>
                      <td className={styles.td}>{r.name}</td>
                      <td className={styles.td}>{r.areaName || '—'}</td>
                      <td className={styles.tdNum}>{r.openingCount ?? '—'}</td>
                      <td className={styles.tdNum}>{r.actualClosing ?? '—'}</td>
                      <td className={styles.tdNum} style={{ color: unitColor, fontWeight: 600 }}>{vUnits > 0 ? '+' : ''}{vUnits}</td>
                      <td className={styles.tdNum} style={{ color: dollarColor, fontWeight: 600 }}>
                        {vDollars == null ? '—' : (vDollars > 0 ? '+' : '') + '$' + Math.abs(Math.round(vDollars)).toLocaleString('en-NZ')}
                      </td>
                      <td className={styles.tdNum}>{r.costPrice != null ? `$${r.costPrice.toFixed(2)}` : '—'}</td>
                      {compareMode && compareItems.length > 0 && (
                        <td className={styles.tdNum} style={{ color: compareItem ? (compareItem.totalVarianceQty < vUnits ? theme.success : compareItem.totalVarianceQty > vUnits ? theme.error : theme.slateMid) : theme.slateMid }}>
                          {compareItem ? `${compareItem.totalVarianceQty > 0 ? '+' : ''}${compareItem.totalVarianceQty} → ${vUnits > 0 ? '+' : ''}${vUnits}` : 'Not in compare'}
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {visibleItems.length === 0 && (
              <p className={styles.emptyCell} style={{ padding: 24, textAlign: 'center' }}>No items match your filters.</p>
            )}
          </div>
          <p style={{ fontSize: 12, color: theme.slateMid, marginTop: 8 }}>{visibleItems.length} items</p>
        </>
      )}
    </div>
  )
}

// ─── AnalysisTab ──────────────────────────────────────────────────────────────

function AnalysisTab({ venueId }: { venueId: string }) {
  const [supplierData, setSupplierData] = useState<Array<{ supplier: string; total: number; count: number; avgCost: number }>>([])
  const [velocityData, setVelocityData] = useState<Array<{ name: string; supplier: string; unitsPerWeek: number; trend: 'rising' | 'stable' | 'falling'; confidence: string }>>([])
  const [loading, setLoading] = useState(true)
  const [velFilter, setVelFilter] = useState<'all' | 'rising' | 'falling' | 'stagnant'>('all')

  useEffect(() => {
    if (!venueId) return
    setLoading(true)
    ;(async () => {
      try {
        const deptsSnap = await getDocs(collection(db, 'venues', venueId, 'departments'))

        // Collect all snapshot items across all depts and cycles
        const allItems: Array<{ name: string; supplierName: string | null; actualClosing: number; costPrice: number | null; cycleNumber: number; completedAt: Date | null; deptId: string }> = []

        await Promise.all(deptsSnap.docs.map(async deptDoc => {
          const snapsSnap = await getDocs(
            query(collection(db, 'venues', venueId, 'departments', deptDoc.id, 'snapshots'), orderBy('cycleNumber', 'desc'), limit(10))
          )
          snapsSnap.docs.forEach(snapDoc => {
            const sd = snapDoc.data() as any
            const completedAt = sd.completedAt?.toDate?.() ?? null
            ;(sd.items || []).forEach((item: any) => {
              allItems.push({
                name: item.name || '',
                supplierName: item.supplierName || null,
                actualClosing: item.actualClosing ?? 0,
                costPrice: item.costPrice ?? null,
                cycleNumber: sd.cycleNumber ?? 0,
                completedAt,
                deptId: deptDoc.id,
              })
            })
          })
        }))

        // Supplier spend aggregation
        const supplierMap = new Map<string, { total: number; count: number; costs: number[] }>()
        for (const it of allItems) {
          if (!it.supplierName || !it.costPrice) continue
          const key = it.supplierName
          const existing = supplierMap.get(key) || { total: 0, count: 0, costs: [] }
          existing.total += it.actualClosing * it.costPrice
          existing.count++
          existing.costs.push(it.costPrice)
          supplierMap.set(key, existing)
        }
        const supplierRows = Array.from(supplierMap.entries())
          .map(([supplier, v]) => ({
            supplier,
            total: v.total,
            count: v.count,
            avgCost: v.costs.reduce((s, c) => s + c, 0) / v.costs.length,
          }))
          .sort((a, b) => b.total - a.total)
          .slice(0, 8)
        setSupplierData(supplierRows)

        // Product velocity
        const productSnapshots = new Map<string, Array<{ qty: number; cycleNumber: number; completedAt: Date | null; supplier: string | null }>>()
        for (const it of allItems) {
          if (!it.name) continue
          const existing = productSnapshots.get(it.name) || []
          existing.push({ qty: it.actualClosing, cycleNumber: it.cycleNumber, completedAt: it.completedAt, supplier: it.supplierName })
          productSnapshots.set(it.name, existing)
        }

        const velocityRows: Array<{ name: string; supplier: string; unitsPerWeek: number; trend: 'rising' | 'stable' | 'falling'; confidence: string }> = []
        productSnapshots.forEach((snaps, name) => {
          if (snaps.length < 2) return
          const sorted = snaps.sort((a, b) => a.cycleNumber - b.cycleNumber)
          // Estimate consumption per cycle
          const diffs: number[] = []
          for (let i = 1; i < sorted.length; i++) {
            const consumed = sorted[i - 1].qty - sorted[i].qty
            diffs.push(consumed)
          }
          const avgConsumed = diffs.reduce((s, d) => s + d, 0) / diffs.length
          const unitsPerWeek = avgConsumed / 2 // approximate: assume 2 weeks between stocktakes
          const trend: 'rising' | 'stable' | 'falling' =
            diffs.length >= 2
              ? diffs[diffs.length - 1] > diffs[0] * 1.2 ? 'rising'
                : diffs[diffs.length - 1] < diffs[0] * 0.8 ? 'falling'
                : 'stable'
              : 'stable'
          const confidence = sorted.length >= 5 ? 'High' : sorted.length >= 3 ? 'Medium' : 'Low'
          velocityRows.push({
            name,
            supplier: sorted[sorted.length - 1].supplier || '—',
            unitsPerWeek: Math.max(0, unitsPerWeek),
            trend,
            confidence,
          })
        })
        setVelocityData(velocityRows.sort((a, b) => b.unitsPerWeek - a.unitsPerWeek).slice(0, 20))
      } catch (e) {
        console.error('[AnalysisTab]', e)
      } finally {
        setLoading(false)
      }
    })()
  }, [venueId])

  function exportSupplierCsv() {
    let csv = 'Supplier,Total Stock Value,Products,Avg Cost Price\n'
    supplierData.forEach(r => { csv += `"${r.supplier}","${r.total.toFixed(2)}","${r.count}","${r.avgCost.toFixed(2)}"\n` })
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'supplier-spend.csv'; a.click(); URL.revokeObjectURL(url)
  }

  function exportVelocityCsv() {
    let csv = 'Product,Supplier,Units/Week,Trend,Confidence\n'
    visibleVelocity.forEach(r => { csv += `"${r.name}","${r.supplier}","${r.unitsPerWeek.toFixed(1)}","${r.trend}","${r.confidence}"\n` })
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'product-velocity.csv'; a.click(); URL.revokeObjectURL(url)
  }

  const visibleVelocity = useMemo(() => {
    if (velFilter === 'all') return velocityData
    if (velFilter === 'rising') return velocityData.filter(r => r.trend === 'rising')
    if (velFilter === 'falling') return velocityData.filter(r => r.trend === 'falling')
    return velocityData.filter(r => r.unitsPerWeek < 0.1)
  }, [velocityData, velFilter])

  if (loading) return <p className={styles.loading}>Loading analysis…</p>

  return (
    <div>
      {/* Supplier Spend */}
      <div className={styles.analysisSection}>
        <div className={styles.sectionToolbar}>
          <div>
            <h2 className={styles.sectionHeading}>Supplier Spend</h2>
            <p className={styles.sectionSubhead}>Total product costs by supplier across all stocktake cycles.</p>
          </div>
          <button type="button" className={styles.exportBtn} onClick={exportSupplierCsv}>Export CSV</button>
        </div>
        {supplierData.length === 0 ? (
          <p className={styles.chartEmpty}>Add supplier names to your products to see spend by supplier.</p>
        ) : (
          <>
            <div className={styles.chartCard}>
              <ResponsiveContainer width="100%" height={CHART_HEIGHT_BAR}>
                <BarChart data={supplierData.map(r => ({ name: r.supplier.length > 14 ? r.supplier.slice(0, 14) + '…' : r.supplier, fullName: r.supplier, total: r.total }))} layout="vertical" margin={{ top: 4, right: 48, left: 0, bottom: 0 }}>
                  <CartesianGrid {...CHART_GRID_PROPS} horizontal={false} vertical={false} />
                  <YAxis type="category" dataKey="name" width={110} tick={CHART_AXIS_TICK} axisLine={false} tickLine={false} />
                  <XAxis type="number" tickFormatter={(v: number) => v >= 1000 ? `$${Math.round(v / 1000)}k` : `$${v}`} tick={CHART_AXIS_TICK} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={((v: number) => [`$${Math.round(v).toLocaleString('en-NZ')}`, 'Total']) as any} labelFormatter={((_: string, p: any[]) => p?.[0]?.payload?.fullName ?? '') as any} cursor={{ fill: 'rgba(11,19,43,0.03)' }} />
                  <Bar dataKey="total" fill={theme.deepBlue} radius={[0, 4, 4, 0]} {...CHART_ANIMATION}>
                    <LabelList dataKey="total" position="right" fontSize={11}
                      formatter={((v: number) => `$${Math.round(v).toLocaleString('en-NZ')}`) as any}
                      style={{ fill: theme.slateMid, fontFamily: theme.fontBody }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className={styles.tableWrap} style={{ marginTop: 12 }}>
              <table className={styles.table}>
                <thead><tr><th>Supplier</th><th>Total stock value</th><th>Products</th><th>Avg cost price</th></tr></thead>
                <tbody>
                  {supplierData.map((r, i) => (
                    <tr key={i} className={styles.dataRow}>
                      <td className={styles.td}>{r.supplier}</td>
                      <td className={styles.tdNum}>${Math.round(r.total).toLocaleString('en-NZ')}</td>
                      <td className={styles.tdNum}>{r.count}</td>
                      <td className={styles.tdNum}>${r.avgCost.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Product Velocity */}
      <div className={styles.analysisSection}>
        <div className={styles.sectionToolbar}>
          <div>
            <h2 className={styles.sectionHeading}>Product Velocity</h2>
            <p className={styles.sectionSubhead}>How fast each product is being consumed based on stocktake history.</p>
          </div>
          <button type="button" className={styles.exportBtn} onClick={exportVelocityCsv}>Export CSV</button>
        </div>
        {velocityData.length === 0 ? (
          <p className={styles.chartEmpty}>Complete 2+ stocktakes to see velocity data.</p>
        ) : (
          <>
            <div className={styles.filterGroup} style={{ marginBottom: 12 }}>
              {(['all', 'rising', 'falling', 'stagnant'] as const).map(f => (
                <button key={f} type="button" className={`${styles.filterBtn} ${velFilter === f ? styles.filterBtnActive : ''}`} onClick={() => setVelFilter(f)}>
                  {f === 'all' ? 'All' : f === 'rising' ? '↑ Rising' : f === 'falling' ? '↓ Falling' : '— Stagnant'}
                </button>
              ))}
            </div>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead><tr><th>Product</th><th>Supplier</th><th>Avg units/week</th><th>Trend</th><th>Confidence</th></tr></thead>
                <tbody>
                  {visibleVelocity.map((r, i) => (
                    <tr key={i} className={styles.dataRow}>
                      <td className={styles.td}>{r.name}</td>
                      <td className={styles.td}>{r.supplier}</td>
                      <td className={styles.tdNum}>{r.unitsPerWeek.toFixed(1)}</td>
                      <td className={styles.td} style={{ color: r.trend === 'rising' ? theme.success : r.trend === 'falling' ? theme.error : theme.slateMid, fontWeight: 600 }}>
                        {r.trend === 'rising' ? '↑ Rising' : r.trend === 'falling' ? '↓ Falling' : '→ Stable'}
                      </td>
                      <td className={styles.td}>{r.confidence}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
