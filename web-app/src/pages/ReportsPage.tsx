import { useEffect, useMemo, useState } from 'react'
import { collection, doc, getDoc, getDocs, limit, orderBy, query, where } from 'firebase/firestore'
import {
  BarChart, Bar, LabelList, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { db } from '../firebase'
import { theme } from '../theme'
import { buildProductMaps, resolveProduct } from '../services/products/resolveProduct'
import { computeVelocity, type VelocityItem } from '../services/products/velocityAnalysis'
import { computeSupplierSpend, type SpendItem } from '../services/products/supplierAnalysis'
import {
  CHART_TOOLTIP_STYLE, CHART_GRID_PROPS, CHART_AXIS_TICK, CHART_DOT,
  CHART_ACTIVE_DOT, CHART_ANIMATION, CHART_HEIGHT_LINE, CHART_HEIGHT_BAR,
} from '../chartConfig'
import { ChartEmptyState } from '../components/ChartEmptyState'
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
  varianceDollars: number | null          // original — kept intact for backward compat
  costPrice: number | null
  // Phase W2 — display-tier additions
  displayVarianceDollars: number | null   // display-preferred; used in chart, sort, table, CSV
  costPriceTier: 'stamped' | 'invoice_verified' | 'none'
  /** Current name from the live products list, only set when it differs from the stamped name. */
  currentName: string | null
}

type CycleRow = {
  deptId: string
  deptName: string
  cycleNumber: number
  completedAt: Date | null
  itemsCounted: number
  totalStockValue: number | null          // loaded as display ?? original at source (Phase W2)
  totalVarianceDollars: number | null     // loaded as display ?? original at source (Phase W2)
  durationMinutes: number | null
}

type PriceChangeRow = {
  id: string
  productName: string
  supplierName: string | null
  oldPrice: number | null
  newPrice: number | null
  changePercent: number | null
  detectedAt: Date | null
  status: string
  impactOnGP: { before: number; after: number } | null
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
  unexplainedVarianceDollars: number | null
  // Phase W2 — display-tier additions
  displayTotalStockValue: number | null
  displayTotalVarianceDollars: number | null
  displayUnexplainedVarianceDollars: number | null
  itemsPricedByInvoice: number
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
  return sign + '$' + abs.toFixed(2)
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

export default function ReportsPage({ venueId, onNavigate }: { venueId: string; onNavigate?: (page: string) => void }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [unmappedCount, setUnmappedCount] = useState(0)

  useEffect(() => {
    if (!venueId) return
    getDocs(query(
      collection(db, 'venues', venueId, 'salesReportUnknowns'),
      where('status', '==', 'unmapped'),
      limit(50)
    )).then(snap => setUnmappedCount(snap.size)).catch(() => {})
  }, [venueId])

  const [deptSummaries, setDeptSummaries] = useState<DeptSummary[]>([])
  const [varianceRows, setVarianceRows] = useState<VarianceRow[]>([])
  const [historyRows, setHistoryRows] = useState<CycleRow[]>([])
  const [priceRows, setPriceRows] = useState<PriceChangeRow[]>([])

  const [varianceSort, setVarianceSort] = useState<SortConfig<VarianceSortKey>>({
    key: 'varianceDollars',
    dir: 'desc',
  })
  const [varianceFilter, setVarianceFilter] = useState<'all' | 'shortages' | 'excesses'>('all')

  type ReportTab = 'summary' | 'cycle-detail' | 'analysis' | 'invoice-history'
  const [activeTab, setActiveTab] = useState<ReportTab>('summary')

  useEffect(() => {
    loadReports()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venueId])

  async function loadReports() {
    setLoading(true)
    setError(false)
    try {
      const [deptsSnap, flagsSnap, prodsSnap] = await Promise.all([
        getDocs(collection(db, 'venues', venueId, 'departments')),
        getDocs(collection(db, 'venues', venueId, 'priceChangeFlags')),
        getDocs(collection(db, 'venues', venueId, 'products')),
      ])
      const { prodById } = buildProductMaps(prodsSnap)

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
              unexplainedVarianceDollars: null,
              displayTotalStockValue: null,
              displayTotalVarianceDollars: null,
              displayUnexplainedVarianceDollars: null,
              itemsPricedByInvoice: 0,
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
            unexplainedVarianceDollars: latestData.summary?.unexplainedVarianceDollars ?? null,
            displayTotalStockValue: latestData.summary?.displayTotalStockValue ?? latestData.summary?.totalStockValue ?? null,
            displayTotalVarianceDollars: latestData.summary?.displayTotalVarianceDollars ?? latestData.summary?.totalVarianceDollars ?? null,
            displayUnexplainedVarianceDollars: latestData.summary?.displayUnexplainedVarianceDollars ?? latestData.summary?.unexplainedVarianceDollars ?? null,
            itemsPricedByInvoice: latestData.summary?.itemsPricedByInvoice ?? 0,
          })

          for (const item of (latestData.items || []) as any[]) {
            const varianceUnits: number = item.unexplainedVarianceQty ?? item.totalVarianceQty ?? 0
            if (varianceUnits === 0) continue
            const stampedName = item.name || '—'
            // Resolve the stamped productId through the merge chain to find the current live product.
            // currentName is only set when the live name differs from the stamped name — null means
            // "nothing to annotate" (names match, productId absent, or product deleted).
            const resolvedId = typeof item.productId === 'string' && item.productId ? item.productId : null
            const resolved = resolvedId ? resolveProduct(resolvedId, prodById) : null
            const resolvedName = resolved?.entry.name ?? null
            const currentName = resolvedName && resolvedName !== stampedName ? resolvedName : null
            varRows.push({
              productId: item.productId || item.name,
              name: stampedName,
              deptName,
              areaName: item.areaName || '—',
              expectedQty: item.openingCount ?? null,
              actualQty: item.actualClosing ?? 0,
              varianceUnits,
              varianceDollars: item.unexplainedVarianceDollars ?? item.totalVarianceDollars ?? null,
              costPrice: item.costPrice ?? null,
              displayVarianceDollars: (item.displayUnexplainedVarianceDollars ?? item.displayTotalVarianceDollars)
                ?? (item.unexplainedVarianceDollars ?? item.totalVarianceDollars) ?? null,
              costPriceTier: item.costPriceTier ?? 'none',
              currentName,
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
              // Display-preferred at load — trend chart and history CSV inherit for free (Phase W2)
              totalStockValue: sd.summary?.displayTotalStockValue ?? sd.summary?.totalStockValue ?? null,
              totalVarianceDollars: sd.summary?.displayTotalVarianceDollars ?? sd.summary?.totalVarianceDollars ?? null,
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
          changePercent: data.changePercent ?? null,
          detectedAt: data.detectedAt?.toDate?.() ?? null,
          status: data.status || 'pending',
          impactOnGP: data.impactOnGP ?? null,
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
      .filter((r) => (r.displayVarianceDollars ?? r.varianceDollars) != null)
      .sort((a, b) =>
        Math.abs((b.displayVarianceDollars ?? b.varianceDollars)!) -
        Math.abs((a.displayVarianceDollars ?? a.varianceDollars)!),
      )
      .slice(0, 10)
      .map((r) => {
        const displayVal = r.displayVarianceDollars ?? r.varianceDollars!
        return {
          name: truncate(r.name, 15),
          fullName: r.name,
          value: Math.abs(displayVal),
          shortage: displayVal < 0,
        }
      }),
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

      // Default sort on varianceDollars: by absolute display-preferred value
      if (key === 'varianceDollars') {
        const aabs = Math.abs((a.displayVarianceDollars ?? a.varianceDollars) ?? 0)
        const babs = Math.abs((b.displayVarianceDollars ?? b.varianceDollars) ?? 0)
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
    let csv = 'Product,Department,Area,Expected,Counted,Unexplained (units),Unexplained ($),Recovered Variance ($)\n'
    for (const r of filteredVariance) {
      const recoveredVar = r.displayVarianceDollars ?? r.varianceDollars
      csv +=
        [
          escCsv(r.name),
          escCsv(r.deptName),
          escCsv(r.areaName),
          r.expectedQty ?? '',
          r.actualQty,
          r.varianceUnits,
          r.varianceDollars != null ? r.varianceDollars.toFixed(2) : '',   // original — byte-identical
          recoveredVar != null ? recoveredVar.toFixed(2) : '',             // display-preferred (additive)
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
    { key: 'varianceUnits', label: 'Unexplained (units)' },
    { key: 'varianceDollars', label: 'Unexplained ($)' },
  ]

  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>Reports</h1>
      <p className={styles.subhead}>Stocktake variance, history, and price changes for your venue.</p>

      {unmappedCount > 0 && (
        <div style={{
          background: '#fef9c3',
          border: '1.5px solid #c47b2b',
          borderRadius: 12,
          padding: '12px 16px',
          marginBottom: 16,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}>
          <span style={{ fontSize: 18 }}>⚠️</span>
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#92400e', fontFamily: theme.fontBody }}>
              {unmappedCount} sales product{unmappedCount !== 1 ? 's' : ''} unmatched
            </p>
            <p style={{ margin: '2px 0 0', fontSize: 13, color: '#92400e', fontFamily: theme.fontBody }}>
              Your reports are incomplete until these are mapped to your catalogue.
            </p>
          </div>
          <button
            onClick={() => onNavigate?.('pos-mapping')}
            style={{
              background: 'none',
              border: '1px solid #c47b2b',
              borderRadius: 999,
              padding: '6px 14px',
              fontSize: 13,
              fontWeight: 700,
              color: '#c47b2b',
              cursor: 'pointer',
              fontFamily: theme.fontBody,
              whiteSpace: 'nowrap',
            }}
          >
            Map now →
          </button>
        </div>
      )}

      {/* ── TAB BAR ── */}
      <div className={styles.tabBar}>
        {(['summary', 'cycle-detail', 'analysis', 'invoice-history'] as ReportTab[]).map(tab => (
          <button
            key={tab}
            type="button"
            className={`${styles.tab} ${activeTab === tab ? styles.tabActive : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab === 'summary'
              ? 'Summary'
              : tab === 'cycle-detail'
              ? 'Cycle Detail'
              : tab === 'analysis'
              ? 'Analysis'
              : 'Invoice History'}
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
              {deptSummaries.map((dept) => {
                if (!dept.hasData) return (
                  <div key={dept.deptId} className={`${styles.card} ${styles.cardEmpty}`}>
                    <p className={styles.cardName}>{dept.deptName}</p>
                    <p className={styles.cardNoData}>No stocktake data yet</p>
                  </div>
                )
                const displayStockValue = dept.displayTotalStockValue ?? dept.totalStockValue
                const showVariance = dept.displayUnexplainedVarianceDollars ?? dept.displayTotalVarianceDollars
                  ?? dept.unexplainedVarianceDollars ?? dept.totalVarianceDollars
                const isEnriched = dept.unexplainedVarianceDollars != null && dept.unexplainedVarianceDollars !== dept.totalVarianceDollars
                return (
                  <div key={dept.deptId} className={styles.card}>
                    <p className={styles.cardName}>{dept.deptName}</p>
                    <p className={styles.cardDate}>
                      {fmtDate(dept.completedAt)} · Stocktake {dept.cycleNumber}
                    </p>
                    <p className={styles.cardMeta}>{dept.itemsCounted} items counted</p>
                    {displayStockValue != null && (
                      <p className={styles.cardValue}>{fmtMoney(displayStockValue)} stock value</p>
                    )}
                    {showVariance != null ? (
                      <p
                        className={styles.cardVariance}
                        style={{
                          color:
                            showVariance < 0
                              ? theme.error
                              : showVariance > 0
                                ? theme.success
                                : theme.slateMid,
                        }}
                      >
                        {showVariance < 0
                          ? '▼'
                          : showVariance > 0
                            ? '▲'
                            : '●'}{' '}
                        {fmtMoney(showVariance)} {isEnriched ? 'unexplained' : 'variance'}
                      </p>
                    ) : (
                      <p className={styles.cardNoData}>Add cost prices to see variance</p>
                    )}
                    {dept.itemsPricedByInvoice > 0 && (() => {
                      // displayTotalStockValue is display??original; totalStockValue is raw original
                      // so the difference is the exact dollar amount recovered by invoice pricing
                      const recoveredAmt =
                        dept.displayTotalStockValue != null && dept.totalStockValue != null
                          ? dept.displayTotalStockValue - dept.totalStockValue
                          : null
                      const recoveredStr = recoveredAmt != null && recoveredAmt !== 0
                        ? `$${Math.abs(Math.round(recoveredAmt)).toLocaleString('en-NZ')} recovered from `
                        : ''
                      return (
                        <p style={{ fontSize: 12, color: theme.slateMid, margin: '4px 0 0', fontFamily: theme.fontBody }}>
                          📄 {recoveredStr}{dept.itemsPricedByInvoice} item{dept.itemsPricedByInvoice !== 1 ? 's' : ''} priced via invoice
                        </p>
                      )
                    })()}
                  </div>
                )
              })}
            </div>
          </section>

          {/* ── CHARTS ── */}
          <div className={styles.chartRow}>
            {/* Chart A — Variance trend */}
            <div className={styles.chartCard}>
              <p className={styles.chartTitle}>Variance trend</p>
              {trendData.length < 2 ? (
                <ChartEmptyState
                  icon="📊"
                  title="No trend yet"
                  body="Complete another stocktake to see how your variance is moving. This is where patterns emerge."
                  height={CHART_HEIGHT_LINE}
                />
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
                <ChartEmptyState
                  icon="💰"
                  title="No dollar impact yet"
                  body="Add cost prices to your products and we'll show you exactly where the money is going."
                  height={CHART_HEIGHT_BAR}
                />
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
                    <Bar dataKey="value" isAnimationActive={false}
                      shape={(props: any) => {
                        const { x, y, width, height, index } = props
                        const fill = topDrivers[index]?.shortage ? theme.error : theme.success
                        return (
                          <rect x={x} y={y} width={width} height={height} fill={fill} rx={4} ry={4}
                            style={{ animation: 'barSlideIn 0.4s ease-out both', animationDelay: `${index * 60}ms`, transformOrigin: 'left center' }} />
                        )
                      }}>
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
                        <td className={styles.td}>
                          {r.name}
                          {r.currentName != null && (
                            <span style={{ fontSize: 12, color: theme.slateMid, marginLeft: 4 }}>
                              (now {r.currentName})
                            </span>
                          )}
                        </td>
                        <td className={styles.td}>{r.deptName}</td>
                        <td className={styles.td}>{r.areaName}</td>
                        <td className={styles.tdNum}>{r.expectedQty != null ? r.expectedQty.toFixed(2) : '—'}</td>
                        <td className={styles.tdNum}>{r.actualQty != null ? r.actualQty.toFixed(2) : '—'}</td>
                        <td
                          className={styles.tdNum}
                          style={{ color: r.varianceUnits < 0 ? theme.error : theme.success }}
                        >
                          {r.varianceUnits > 0 ? '+' : ''}
                          {r.varianceUnits.toFixed(2)}
                        </td>
                        <td
                          className={styles.tdNum}
                          style={{
                            color:
                              (r.displayVarianceDollars ?? r.varianceDollars) == null
                                ? theme.slateMid
                                : (r.displayVarianceDollars ?? r.varianceDollars)! < 0
                                  ? theme.error
                                  : theme.success,
                            fontWeight: 600,
                          }}
                        >
                          {(r.displayVarianceDollars ?? r.varianceDollars) == null
                            ? '—'
                            : ((r.displayVarianceDollars ?? r.varianceDollars)! > 0 ? '+' : '') +
                              fmtMoney(r.displayVarianceDollars ?? r.varianceDollars) +
                              (r.costPriceTier === 'invoice_verified' ? ' 📄' : '')}
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
                      <th>Margin</th>
                      <th>Detected</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {priceRows.map((r) => {
                      // Prefer the stored changePercent (present on invoice-flagged rows);
                      // fall back to an inline calculation for contract-extraction rows which
                      // don't go through flagPriceChangeToManager and have no changePercent.
                      const changePct =
                        r.changePercent != null
                          ? r.changePercent
                          : r.oldPrice != null && r.newPrice != null && r.oldPrice > 0
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
                          <td className={styles.tdNum}>
                            {r.impactOnGP != null
                              ? `${r.impactOnGP.before}% → ${r.impactOnGP.after}%`
                              : '—'}
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
      {activeTab === 'invoice-history' && (
        <div className={styles.tabSection}>
          <HistoricalInvoiceTab
            venueId={venueId}
            onReviewConflicts={() => setActiveTab('summary')}
          />
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
      // TODO(pre-existing bug — do not fix here): sortKey 'varianceDollars' doesn't match
      // the item field name 'totalVarianceDollars', so that column sort silently does nothing.
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
    // Additive columns — Variance Dollars and Cost Price columns are byte-identical to pre-Phase-W2
    let csv = 'Product,Area,Expected,Actual,Variance Units,Variance Dollars,Recovered Variance Dollars,Cost Price,Recovered Cost Price\n'
    for (const r of visibleItems) {
      const recoveredVar = r.displayTotalVarianceDollars ?? r.totalVarianceDollars
      const recoveredCost = r.displayCostPrice ?? r.costPrice
      csv += [
        r.name, r.areaName, r.openingCount ?? '', r.actualClosing ?? '',
        r.totalVarianceQty ?? '',
        r.totalVarianceDollars ?? '',          // original — byte-identical
        recoveredVar ?? '',                     // display-preferred (additive)
        r.costPrice ?? '',                      // original — byte-identical
        recoveredCost ?? '',                    // display-preferred (additive)
      ].map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',') + '\n'
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
        <ChartEmptyState
          icon="📋"
          title="Select a stocktake above"
          body="Choose a department and stocktake to see the full item breakdown."
          height={200}
        />
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
                  // Display-preferred variance dollars — Phase W2
                  const vDollars = r.displayTotalVarianceDollars ?? r.totalVarianceDollars
                  const unitColor = vUnits < 0 ? theme.error : vUnits > 0 ? theme.success : theme.slateMid
                  const dollarColor = vDollars == null ? theme.slateMid : vDollars < 0 ? theme.error : vDollars > 0 ? theme.success : theme.slateMid
                  // Display-preferred cost price — Phase W2
                  const displayCostPrice = r.displayCostPrice ?? r.costPrice
                  const compareItem = compareMap.get(r.name)
                  return (
                    <tr key={i} className={styles.dataRow}>
                      <td className={styles.td}>{r.name}{r.costPriceTier === 'invoice_verified' ? ' 📄' : ''}</td>
                      <td className={styles.td}>{r.areaName || '—'}</td>
                      <td className={styles.tdNum}>{r.openingCount != null ? r.openingCount.toFixed(2) : '—'}</td>
                      <td className={styles.tdNum}>{r.actualClosing != null ? r.actualClosing.toFixed(2) : '—'}</td>
                      <td className={styles.tdNum} style={{ color: unitColor, fontWeight: 600 }}>{vUnits > 0 ? '+' : ''}{vUnits.toFixed(2)}</td>
                      <td className={styles.tdNum} style={{ color: dollarColor, fontWeight: 600 }}>
                        {vDollars == null ? '—' : (vDollars > 0 ? '+' : '') + '$' + Math.abs(Math.round(vDollars)).toLocaleString('en-NZ')}
                      </td>
                      <td className={styles.tdNum}>{displayCostPrice != null ? `$${displayCostPrice.toFixed(2)}${r.costPriceTier === 'invoice_verified' ? ' 📄' : ''}` : '—'}</td>
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
        const [deptsSnap, prodsSnap] = await Promise.all([
          getDocs(collection(db, 'venues', venueId, 'departments')),
          getDocs(collection(db, 'venues', venueId, 'products')),
        ])
        const { prodById } = buildProductMaps(prodsSnap)

        // Collect all snapshot items across all depts and cycles
        const allItems: Array<VelocityItem & SpendItem & { costPrice: number | null; displayCostPrice: number | null; completedAt: Date | null; deptId: string }> = []

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
                productId: item.productId || null,
                supplierId: item.supplierId || null,
                supplierName: item.supplierName || null,
                actualClosing: item.actualClosing ?? 0,
                costPrice: item.costPrice ?? null,
                displayCostPrice: item.displayCostPrice ?? null,   // Phase W2
                cycleNumber: sd.cycleNumber ?? 0,
                completedAt,
                deptId: deptDoc.id,
              })
            })
          })
        }))

        // Supplier spend aggregation — groups by supplierId when present (post-fix
        // snapshot items), falling back to supplierName for pre-fix (name-only) items.
        // A supplier with both old and new items produces two separate rows rather than
        // one falsely merged row — do not guess the link that was never captured.
        const supplierRows = computeSupplierSpend(allItems).sort((a, b) => b.total - a.total).slice(0, 8)
        setSupplierData(supplierRows)

        // Product velocity — groups by resolved product id so a rename mid-history
        // produces one continuous series, not two silently disconnected ones.
        const velocityRows = computeVelocity(allItems, prodById)
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
          <ChartEmptyState
            icon="🤝"
            title="No supplier data yet"
            body="Assign suppliers to your products and we'll show you your spend breakdown."
            height={CHART_HEIGHT_BAR}
          />
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
          <ChartEmptyState
            icon="⚡"
            title="No velocity data yet"
            body="Complete two or more stocktakes and we'll show you how fast each product moves."
            height={CHART_HEIGHT_BAR}
          />
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

// ─── HistoricalInvoiceTab ─────────────────────────────────────────────────────

/** One row in the unified historical-invoice table. */
export type HistoricalRow =
  | {
      kind: 'conflict'
      flagId: string
      productId: string
      productName: string
      supplierName: string | null
      /** Current (protected) cost price on the product doc. */
      currentPrice: number | null
      /** Invoice price that was NOT applied because costPrice already existed. */
      invoicePrice: number | null
      changePercent: number | null
      direction: 'increase' | 'decrease' | null
      /** Original invoice date string (YYYY-MM-DD or ISO). */
      invoiceDate: string | null
      /** When the flag was written to Firestore. */
      flaggedAt: Date | null
      status: string
    }
  | {
      kind: 'first_price' | 'new_product'
      productId: string
      productName: string
      supplierName: string | null
      costPrice: number | null
      /** Original invoice date, fetched from product's priceHistory subcollection. */
      invoiceDate: string | null
      /** When the product's costPrice was last updated (proxy for "when written"). */
      backfilledAt: Date | null
    }

/**
 * Pure helper — maps a HistoricalRow to its human-readable scenario label.
 * Tested independently; no Firebase dependency.
 */
export function scenarioLabel(row: HistoricalRow): string {
  switch (row.kind) {
    case 'conflict':
      return 'Price protected — conflict queued for review'
    case 'first_price':
      return 'Initial price set from historical invoice'
    case 'new_product':
      return 'New product created from historical invoice'
  }
}

/**
 * Scenario badge colour token — returned as a CSS class suffix so tests can
 * assert on it without touching the DOM.
 */
export function scenarioBadgeVariant(row: HistoricalRow): 'conflict' | 'firstPrice' | 'newProduct' {
  switch (row.kind) {
    case 'conflict':   return 'conflict'
    case 'first_price': return 'firstPrice'
    case 'new_product': return 'newProduct'
  }
}

function fmtInvoiceDate(s: string | null): string {
  if (!s) return '—'
  const d = new Date(s)
  if (isNaN(d.getTime())) return s
  return d.toLocaleDateString('en-NZ', { day: '2-digit', month: 'short', year: 'numeric' })
}

function HistoricalInvoiceTab({
  venueId,
  onReviewConflicts,
}: {
  venueId: string
  onReviewConflicts: () => void
}) {
  const [rows, setRows] = useState<HistoricalRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venueId])

  async function load() {
    setLoading(true)
    setError(false)
    try {
      // ── Case 1 conflicts — flat query, includes all the fields we need ───────
      const conflictSnap = await getDocs(
        query(
          collection(db, 'venues', venueId, 'priceChangeFlags'),
          where('flagReason', '==', 'historical_invoice_conflict'),
          orderBy('flaggedAt', 'desc'),
          limit(200),
        ),
      )
      const conflictRows: HistoricalRow[] = conflictSnap.docs.map((d) => {
        const data = d.data() as any
        return {
          kind: 'conflict',
          flagId: d.id,
          productId: data.productId ?? '',
          productName: data.productName || '—',
          supplierName: data.supplierName ?? null,
          currentPrice: data.oldPrice ?? null,
          invoicePrice: data.newPrice ?? null,
          changePercent: data.changePercent ?? null,
          direction: data.direction ?? null,
          invoiceDate: data.proposedHistoricalInvoiceDate ?? null,
          flaggedAt: data.flaggedAt?.toDate?.() ?? null,
          status: data.status || 'pending',
        }
      })

      // ── Cases 2 & 3 — products with costPriceSource:'historical-invoice' ────
      const prodsSnap = await getDocs(
        query(
          collection(db, 'venues', venueId, 'products'),
          where('costPriceSource', '==', 'historical-invoice'),
          limit(500),
        ),
      )

      // Fetch original invoiceDate from each product's priceHistory (best-effort, parallel)
      const productRows: HistoricalRow[] = await Promise.all(
        prodsSnap.docs.map(async (d) => {
          const data = d.data() as any
          const isNewProduct = data.inductionSource === 'invoice-price-tracking'

          let invoiceDate: string | null = null
          try {
            const phSnap = await getDocs(
              query(
                collection(db, 'venues', venueId, 'products', d.id, 'priceHistory'),
                where('isHistoricalBackfill', '==', true),
                limit(1),
              ),
            )
            if (!phSnap.empty) {
              invoiceDate = phSnap.docs[0].data().invoiceDate ?? null
            }
          } catch {}

          return {
            kind: isNewProduct ? 'new_product' : 'first_price',
            productId: d.id,
            productName: data.name || '—',
            supplierName: data.supplierName ?? data.primarySupplierName ?? null,
            costPrice: typeof data.costPrice === 'number' && data.costPrice > 0 ? data.costPrice : null,
            invoiceDate,
            backfilledAt: data.costPriceUpdatedAt?.toDate?.() ?? null,
          } satisfies HistoricalRow
        }),
      )

      // Unified list — conflicts first (pending before acknowledged), then products
      const allRows: HistoricalRow[] = [
        ...conflictRows.sort((a, b) => {
          if (a.kind !== 'conflict' || b.kind !== 'conflict') return 0
          if (a.status === 'pending' && b.status !== 'pending') return -1
          if (b.status === 'pending' && a.status !== 'pending') return 1
          return (b.flaggedAt?.getTime() ?? 0) - (a.flaggedAt?.getTime() ?? 0)
        }),
        ...productRows.sort((a, b) => {
          if (a.kind === 'conflict' || b.kind === 'conflict') return 0
          return (
            (b.backfilledAt?.getTime() ?? 0) - (a.backfilledAt?.getTime() ?? 0)
          )
        }),
      ]

      setRows(allRows)
    } catch (e) {
      console.error('[HistoricalInvoiceTab]', e)
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return <p className={styles.emptyState}>Loading historical invoice records…</p>
  }
  if (error) {
    return (
      <p className={styles.emptyState} style={{ color: '#dc2626' }}>
        Could not load historical invoice records.
      </p>
    )
  }
  if (rows.length === 0) {
    return (
      <section className={styles.section}>
        <h2 className={styles.sectionHeading}>Historical Invoice Outcomes</h2>
        <p className={styles.sectionSubhead}>
          Products touched by historical invoices (older than 3 months) appear here.
        </p>
        <p className={styles.emptyState}>
          No historical invoice records found. They appear automatically when invoices
          dated more than 3 months ago are processed.
        </p>
      </section>
    )
  }

  const conflictCount = rows.filter((r) => r.kind === 'conflict' && r.status === 'pending').length

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionHeading}>Historical Invoice Outcomes</h2>
      <p className={styles.sectionSubhead}>
        Per-product results from invoices older than 3 months. Prices shown are unit costs
        (ex-GST). Three distinct outcomes are possible depending on whether the product
        existed and already had a recorded cost price.
      </p>

      {conflictCount > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            background: '#fef3c7',
            border: '1px solid #fbbf24',
            borderRadius: 8,
            padding: '10px 16px',
            marginBottom: 20,
            fontSize: 13,
            color: '#92400e',
            fontWeight: 600,
          }}
        >
          <span>⚠ {conflictCount} pending price conflict{conflictCount !== 1 ? 's' : ''} need review</span>
          <button
            type="button"
            onClick={onReviewConflicts}
            style={{
              marginLeft: 'auto',
              background: '#92400e',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              padding: '5px 12px',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              fontFamily: 'Inter, system-ui, sans-serif',
            }}
          >
            Review in Price Changes →
          </button>
        </div>
      )}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Product</th>
              <th>Outcome</th>
              <th>Supplier</th>
              <th>Invoice price</th>
              <th>Current price</th>
              <th>Invoice date</th>
              <th>Written</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const label = scenarioLabel(row)
              const variant = scenarioBadgeVariant(row)
              const badgeStyle: React.CSSProperties =
                variant === 'conflict'
                  ? { background: '#fef3c7', color: '#92400e', border: '1px solid #fbbf24' }
                  : variant === 'firstPrice'
                  ? { background: '#eff6ff', color: '#1e40af', border: '1px solid #93c5fd' }
                  : { background: '#f0fdf4', color: '#166534', border: '1px solid #86efac' }

              if (row.kind === 'conflict') {
                const pct = row.changePercent
                const isUp = row.direction === 'increase'
                return (
                  <tr
                    key={`conflict-${row.flagId}`}
                    className={styles.dataRow}
                  >
                    <td className={styles.td}>{row.productName}</td>
                    <td className={styles.td}>
                      <span
                        className={styles.badge}
                        style={{ ...badgeStyle, whiteSpace: 'nowrap' }}
                      >
                        {label}
                      </span>
                    </td>
                    <td className={styles.td}>{row.supplierName ?? '—'}</td>
                    <td className={styles.tdNum}>
                      {fmtMoney(row.invoicePrice)}
                      {pct != null && (
                        <span
                          style={{
                            fontSize: 11,
                            marginLeft: 4,
                            color: isUp ? '#dc2626' : '#16a34a',
                            fontWeight: 600,
                          }}
                        >
                          {isUp ? '▲' : '▼'} {Math.abs(pct).toFixed(1)}%
                        </span>
                      )}
                    </td>
                    <td className={styles.tdNum}>{fmtMoney(row.currentPrice)}</td>
                    <td className={styles.td}>{fmtInvoiceDate(row.invoiceDate)}</td>
                    <td className={styles.td}>{fmtDate(row.flaggedAt)}</td>
                    <td className={styles.td}>
                      <span
                        className={`${styles.badge} ${row.status === 'pending' ? styles.badgePending : styles.badgeAck}`}
                        style={{ marginRight: 8 }}
                      >
                        {row.status}
                      </span>
                      {row.status === 'pending' && (
                        <button
                          type="button"
                          onClick={onReviewConflicts}
                          style={{
                            background: 'none',
                            border: '1px solid #d97706',
                            borderRadius: 5,
                            padding: '2px 8px',
                            fontSize: 11,
                            fontWeight: 600,
                            color: '#92400e',
                            cursor: 'pointer',
                            fontFamily: 'Inter, system-ui, sans-serif',
                          }}
                        >
                          Review →
                        </button>
                      )}
                    </td>
                  </tr>
                )
              }

              // Cases 2 & 3
              return (
                <tr key={`prod-${row.productId}-${i}`} className={styles.dataRow}>
                  <td className={styles.td}>{row.productName}</td>
                  <td className={styles.td}>
                    <span
                      className={styles.badge}
                      style={{ ...badgeStyle, whiteSpace: 'nowrap' }}
                    >
                      {label}
                    </span>
                  </td>
                  <td className={styles.td}>{row.supplierName ?? '—'}</td>
                  <td className={styles.tdNum}>{fmtMoney(row.costPrice)}</td>
                  <td className={styles.tdNum}>{fmtMoney(row.costPrice)}</td>
                  <td className={styles.td}>{fmtInvoiceDate(row.invoiceDate)}</td>
                  <td className={styles.td}>{fmtDate(row.backfilledAt)}</td>
                  <td className={styles.td}>—</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
