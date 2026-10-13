import { useEffect, useState, useMemo } from 'react'
import {
  collection, getDocs, getDoc, doc,
  query, where, orderBy, limit,
} from 'firebase/firestore'
import { db } from '../firebase'
import { isReportActive } from '../utils/isReportActive'
import {
  partitionReports,
  mapAllReports,
  buildStrip,
  buildVelocityRowsFromReports,
  buildUnmatchedRows,
  normName,
  weekMonday,
  isSquareSource,
  NZ_TZ,
  type ActiveReport,
  type MatchData,
  type StockEntry,
  type VelocityRow,
  type VelocityWindowInfo,
  type UnmatchedRow,
  type StripCell,
  type RawSalesLine,
} from '../utils/weeklyLedger'
import { voidSalesReport } from '../services/voidSalesReport'
import styles from './SalesReportsPage.module.css'

// ── Types ─────────────────────────────────────────────────────────────────────

type TabKey = 'reports' | 'velocity' | 'unmatched'

type RawDoc = {
  id: string
  data(): Record<string, any>
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(s: string | null): string {
  if (!s) return '—'
  const d = new Date(s + 'T12:00:00')
  return isFinite(d.getTime()) ? d.toLocaleDateString('en-NZ', { day: '2-digit', month: 'short', year: 'numeric' }) : s
}

function fmtMoney(n: number | null | undefined): string {
  if (n == null) return '—'
  return `$${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`
}

function fmtNum(n: number): string {
  return n.toFixed(0)
}

function sourceFormatLabel(sf: string | null | undefined): { label: string; title: string } {
  switch (sf) {
    case 'square':       return { label: 'Square',             title: 'Square POS (daily sync)' }
    case 'bustle_rich':  return { label: 'GP per product',     title: 'Bustle rich GP export' }
    case 'bustle_items': return { label: 'Sales by category',  title: 'Bustle items export' }
    case 'pdf':          return { label: 'PDF',                title: 'PDF import' }
    default:             return { label: 'Legacy',             title: 'Legacy format — re-import to see format badge' }
  }
}

function canVoidReport(r: ActiveReport, canManage: boolean): boolean {
  return canManage && r.meta?.sourceFormat !== 'square' && reportStatus(r) === 'active'
}

function gstBasisLabel(g: string | null | undefined): string {
  switch (g) {
    case 'explicit':     return 'GST incl & excl in file'
    case 'assumed_incl': return 'assumed incl GST'
    default:             return 'unknown'
  }
}

function reportStatus(r: ActiveReport): 'active' | 'superseded' | 'voided' {
  if (r.status === 'voided')     return 'voided'
  if (r.status === 'superseded') return 'superseded'
  return 'active'
}

// ── Void modal ────────────────────────────────────────────────────────────────

function VoidModal({
  venueId,
  report,
  onClose,
  onDone,
}: {
  venueId: string
  report: ActiveReport
  onClose: () => void
  onDone: () => void
}) {
  const [reason, setReason]       = useState('')
  const [confirm, setConfirm]     = useState('')
  const [pending, setPending]     = useState(false)
  const [error, setError]         = useState<string | null>(null)

  const canSubmit = reason.trim().length >= 3 && confirm === 'VOID' && !pending

  async function submit() {
    if (!canSubmit) return
    setPending(true)
    setError(null)
    try {
      await voidSalesReport(venueId, report.id, reason.trim())
      onDone()
    } catch (e: any) {
      setError(e?.message ?? 'Void failed')
      setPending(false)
    }
  }

  return (
    <div className={styles.modalOverlay} onClick={() => { if (!pending) onClose() }}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <p className={styles.modalTitle}>Void sales report</p>
        <p className={styles.modalWarning}>
          Stocktake figures already saved keep the sales data they had when saved.
          Voiding removes this report from analytics and lets you re-import it.
        </p>

        <label className={styles.modalLabel}>
          Reason (required)
          <input
            className={styles.modalInput}
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="e.g. Wrong date range, duplicate import"
            autoFocus
          />
        </label>

        <label className={styles.modalLabel}>
          Type VOID to confirm
          <input
            className={styles.modalInput}
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            placeholder="VOID"
          />
        </label>

        {error && <p className={styles.errorText}>{error}</p>}

        <div className={styles.modalActions}>
          <button className={styles.btnSecondary} onClick={() => { if (!pending) onClose() }}>Cancel</button>
          <button className={styles.btnPrimary} disabled={!canSubmit} onClick={submit}>
            {pending ? 'Voiding…' : 'Void report'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Lines drawer ──────────────────────────────────────────────────────────────

function LinesDrawer({
  report,
  matches,
  onClose,
}: {
  report: ActiveReport
  matches: MatchData | null
  onClose: () => void
}) {
  const matchedNames = useMemo(
    () => new Set((matches?.matches ?? []).map(m => normName(m.name ?? m.productName))),
    [matches]
  )

  return (
    <div className={styles.drawerOverlay} onClick={onClose}>
      <div className={styles.drawer} onClick={e => e.stopPropagation()}>
        <button className={styles.drawerClose} onClick={onClose}>×</button>
        <p className={styles.drawerTitle}>
          {report.lineCount} lines · {fmtDate(report.startStr)} – {fmtDate(report.endStr)}
        </p>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Qty</th>
                <th>Gross</th>
                <th>Net</th>
                <th>Category</th>
                <th>Matched</th>
              </tr>
            </thead>
            <tbody>
              {report.rawLines.map((l, i) => (
                <tr key={i}>
                  <td>{l.name ?? '—'}</td>
                  <td>{l.qtySold ?? 0}</td>
                  <td>{fmtMoney(l.grossIncl ?? l.gross)}</td>
                  <td>{fmtMoney(l.netExcl ?? l.net)}</td>
                  <td>{l.category ?? '—'}</td>
                  <td>{matchedNames.has(normName(l.name)) ? '✓' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ── Square week helpers ───────────────────────────────────────────────────────

/** Groups Square daily docs by calendar week and returns a virtual ActiveReport for each week. */
function squareWeekRows(docs: ActiveReport[]): Array<ActiveReport & { _squareDocs: ActiveReport[] }> {
  const byWeek = new Map<string, ActiveReport[]>()
  for (const r of docs) {
    if (!r.startStr) continue
    const mon = weekMonday(r.startStr)
    if (!byWeek.has(mon)) byWeek.set(mon, [])
    byWeek.get(mon)!.push(r)
  }
  return [...byWeek.entries()].map(([mon, wkDocs]) => {
    const sun = new Date(new Date(mon + 'T00:00:00Z').getTime() + 6 * 86_400_000).toISOString().slice(0, 10)
    const aggLines = new Map<string, RawSalesLine>()
    for (const d of wkDocs) {
      for (const l of d.rawLines) {
        const key = (l.name ?? '').toLowerCase().trim()
        if (!aggLines.has(key)) {
          aggLines.set(key, { name: l.name, qtySold: 0, grossIncl: 0 })
        }
        const e = aggLines.get(key)!
        e.qtySold = (e.qtySold ?? 0) + (l.qtySold ?? 0)
        e.grossIncl = (e.grossIncl ?? 0) + (l.grossIncl ?? l.gross ?? 0)
      }
    }
    const rawLines = [...aggLines.values()]
    const totalRevenue = rawLines.reduce((s, l) => s + (l.grossIncl ?? 0), 0)
    const totalQtySold = rawLines.reduce((s, l) => s + (l.qtySold ?? 0), 0)
    return {
      id:               `_sq_week_${mon}`,
      source:           'square',
      startStr:         mon,
      endStr:           sun,
      startMs:          new Date(mon + 'T00:00:00Z').getTime(),
      days:             wkDocs.length,
      lineCount:        rawLines.length,
      totalRevenue,
      totalQtySold,
      rawLines,
      overlappingCycles: [],
      allocationMethod: 'none',
      status:           null,
      meta:             { sourceFormat: 'square', lineTotalsBasis: 'line_total', gstBasis: 'assumed_incl' },
      _squareDocs:      wkDocs,
    }
  })
}

// ── Tab 1: Reports ────────────────────────────────────────────────────────────

function ReportsTab({
  allReports,
  matchesByReport,
  canManage,
  onDataChange,
  venueId,
}: {
  allReports: ActiveReport[]
  matchesByReport: Record<string, MatchData | null>
  canManage: boolean
  onDataChange: () => void
  venueId: string
}) {
  const [drawerReport, setDrawerReport] = useState<ActiveReport | null>(null)
  const [voidReport, setVoidReport]     = useState<ActiveReport | null>(null)

  const strip: StripCell[] = useMemo(
    () => buildStrip(allReports, new Date().toLocaleDateString('en-CA', { timeZone: NZ_TZ })),
    [allReports]
  )

  // Build table rows: Square docs collapsed by week, others individually, newest first
  type TableRow = (ActiveReport & { _squareDocs?: ActiveReport[] })
  const tableRows = useMemo<TableRow[]>(() => {
    const squareDocs  = allReports.filter(r => isSquareSource(r.id, r.source))
    const regularDocs = allReports.filter(r => !isSquareSource(r.id, r.source))
    const squareWks   = squareWeekRows(squareDocs)
    return [...regularDocs, ...squareWks].sort((a, b) => (b.startMs ?? 0) - (a.startMs ?? 0))
  }, [allReports])

  return (
    <div>
      {/* 26-week strip */}
      <div className={styles.strip}>
        {strip.map(cell => (
          <div
            key={cell.monday}
            className={`${styles.stripCell} ${
              cell.state === 'present' ? styles.stripPresent :
              cell.state === 'partial' ? styles.stripPartial :
              cell.state === 'voided'  ? styles.stripVoided  :
              styles.stripMissing
            }`}
            title={`${cell.monday} — ${cell.state}`}
          />
        ))}
      </div>
      <div className={styles.stripLegend}>
        <span><span className={styles.legendDot} style={{ background: '#10b981' }} />Present</span>
        <span><span className={styles.legendDot} style={{ background: '#fbbf24' }} />Partial (&lt;7 days)</span>
        <span><span className={styles.legendDot} style={{ background: '#e5e7eb' }} />Missing</span>
        <span><span className={styles.legendDot} style={{ background: '#f87171' }} />Voided only</span>
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Period</th>
              <th>Format</th>
              <th>Status</th>
              <th>Lines</th>
              <th>Units</th>
              <th>Revenue (incl)</th>
              <th>Revenue (excl)</th>
              <th>GST basis</th>
              <th>Matched</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {tableRows.map(r => {
              const isSquareWk = r.meta?.sourceFormat === 'square'
              const md = isSquareWk ? null : matchesByReport[r.id]
              const sf = sourceFormatLabel(r.meta?.sourceFormat)
              const hasLineTotals = r.meta?.lineTotalsBasis === 'line_total'
              const hasMeta = !!r.meta?.sourceFormat
              const st = isSquareWk ? 'active' as const : reportStatus(r)

              const grossSum = hasLineTotals
                ? r.rawLines.reduce((s, l) => s + (l.grossIncl ?? l.gross ?? 0), 0)
                : null
              const netSum = (!isSquareWk && hasLineTotals)
                ? r.rawLines.reduce((s, l) => s + (l.netExcl ?? l.net ?? 0), 0)
                : null

              return (
                <tr key={r.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {isSquareWk
                      ? <><span style={{ fontWeight: 500 }}>Square · {r.days} day{(r.days ?? 1) !== 1 ? 's' : ''}</span><br /><span style={{ color: '#9ca3af', fontSize: 11 }}>{fmtDate(r.startStr)} – {fmtDate(r.endStr)}</span></>
                      : <>{fmtDate(r.startStr)}<br /><span style={{ color: '#9ca3af', fontSize: 11 }}>→ {fmtDate(r.endStr)}</span></>
                    }
                  </td>
                  <td>
                    <span className={`${styles.badge} ${hasMeta ? styles.badgeFormat : styles.badgeLegacy}`} title={sf.title}>
                      {sf.label}
                    </span>
                  </td>
                  <td>
                    <span className={`${styles.badge} ${
                      st === 'active'     ? styles.badgeActive :
                      st === 'voided'     ? styles.badgeVoided :
                      styles.badgeSuperseded
                    }`}>
                      {st}
                    </span>
                  </td>
                  <td>{r.lineCount}</td>
                  <td>{fmtNum(r.totalQtySold)}</td>
                  <td>
                    {hasLineTotals
                      ? fmtMoney(grossSum)
                      : <span style={{ color: '#9ca3af', fontSize: 11 }}>legacy: re-import to see revenue</span>
                    }
                  </td>
                  <td>
                    {isSquareWk
                      ? <span style={{ color: '#9ca3af', fontSize: 11 }}>incl only</span>
                      : hasLineTotals && netSum != null && netSum > 0
                        ? fmtMoney(netSum)
                        : hasLineTotals ? '—' : <span style={{ color: '#9ca3af', fontSize: 11 }}>legacy</span>
                    }
                  </td>
                  <td style={{ fontSize: 11, color: '#6b7280' }}>{gstBasisLabel(r.meta?.gstBasis)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {isSquareWk
                      ? <span style={{ color: '#9ca3af' }}>—</span>
                      : md
                        ? `${md.matched}/${md.total}`
                        : <span style={{ color: '#9ca3af' }}>—</span>
                    }
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button
                      className={`${styles.btnSmall} ${styles.btnOutline}`}
                      onClick={() => setDrawerReport(r)}
                      style={{ marginRight: 6 }}
                    >
                      View lines
                    </button>
                    {canVoidReport(r, canManage)
                      ? (
                        <button
                          className={`${styles.btnSmall} ${styles.btnDanger}`}
                          onClick={() => setVoidReport(r)}
                        >
                          Void
                        </button>
                      )
                      : isSquareWk && canManage
                        ? <span style={{ color: '#9ca3af', fontSize: 11, cursor: 'default' }} title="POS-synced data can't be voided">Void</span>
                        : null
                    }
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {drawerReport && (
        <LinesDrawer
          report={drawerReport}
          matches={matchesByReport[drawerReport.id] ?? null}
          onClose={() => setDrawerReport(null)}
        />
      )}

      {voidReport && (
        <VoidModal
          venueId={venueId}
          report={voidReport}
          onClose={() => setVoidReport(null)}
          onDone={() => { setVoidReport(null); onDataChange() }}
        />
      )}
    </div>
  )
}

// ── Tab 2: Velocity ───────────────────────────────────────────────────────────

type VelocitySortKey = 'last4' | 'change' | 'status'

function VelocityTab({
  activeReports,
  matchesByReport,
  stockMap,
}: {
  activeReports: ActiveReport[]
  matchesByReport: Record<string, MatchData | null>
  stockMap: Record<string, StockEntry>
}) {
  const todayNZ = new Date().toLocaleDateString('en-CA', { timeZone: NZ_TZ })
  const [sortKey, setSortKey] = useState<VelocitySortKey>('last4')

  const { rows: rawRows, windowInfo } = useMemo(
    () => buildVelocityRowsFromReports(activeReports, matchesByReport, stockMap, todayNZ),
    [activeReports, matchesByReport, stockMap, todayNZ]
  ) as { rows: VelocityRow[]; windowInfo: VelocityWindowInfo }

  const unmatchedCount = activeReports.filter(r => matchesByReport[r.id] == null).length
  const totalMatched = activeReports.reduce((s, r) => s + (matchesByReport[r.id]?.matched ?? 0), 0)
  const totalLines   = activeReports.reduce((s, r) => s + r.lineCount, 0)
  const dataEndsBefore = windowInfo.newestReportEnd != null && windowInfo.newestReportEnd < windowInfo.anchorMonday

  const sorted = useMemo(() => {
    return [...rawRows].sort((a, b) => {
      if (sortKey === 'last4')  return b.last4Units - a.last4Units
      if (sortKey === 'change') return (b.changePct ?? -Infinity) - (a.changePct ?? -Infinity)
      const order: Record<string, number> = { 'Sold out': 0, 'No recent data': 1, 'Stagnant': 2, 'Slowing': 3, 'Selling': 4 }
      return (order[a.status] ?? 5) - (order[b.status] ?? 5)
    })
  }, [rawRows, sortKey])

  function SortBtn({ k, label }: { k: VelocitySortKey; label: string }) {
    return (
      <button
        className={`${styles.btnSmall} ${sortKey === k ? styles.badgeActive : styles.btnOutline}`}
        style={{ marginRight: 6 }}
        onClick={() => setSortKey(k)}
      >
        {label}
      </button>
    )
  }

  return (
    <div>
      {unmatchedCount > 0 && (
        <div className={`${styles.banner} ${styles.bannerAmber}`}>
          {unmatchedCount} report{unmatchedCount !== 1 ? 's' : ''} not matched yet — excluded from velocity.
        </div>
      )}
      <div className={`${styles.banner} ${styles.bannerGray}`}>
        Anchor week: {windowInfo.anchorMonday}
        {' · '}last 4 wks: {windowInfo.last4CoveredDays} covered days
        {' · '}prev 4 wks: {windowInfo.prev4CoveredDays} covered days
        {dataEndsBefore && ` · Sales data ends ${windowInfo.newestReportEnd}`}
        {' · '}match coverage: {totalMatched}/{totalLines} lines
      </div>

      <div style={{ marginBottom: 12 }}>
        Sort: <SortBtn k="last4" label="Units (last 4 wks)" />
        <SortBtn k="change" label="Change %" />
        <SortBtn k="status" label="Status" />
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Product</th>
              <th>Last 4 wks</th>
              <th>Prev 4 wks</th>
              <th>Change</th>
              <th>Since last sale</th>
              <th>Stock</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(r => (
              <tr key={r.productId}>
                <td>{r.name}</td>
                <td>{fmtNum(r.last4Units)}</td>
                <td>{fmtNum(r.prev4Units)}</td>
                <td>{r.changePct != null ? `${r.changePct > 0 ? '+' : ''}${r.changePct.toFixed(0)}%` : '—'}</td>
                <td>{r.weeksSinceLastSale != null ? `${r.weeksSinceLastSale} wk(s)` : '—'}</td>
                <td>{r.latestStock != null ? r.latestStock : '—'}</td>
                <td className={
                  r.status === 'Sold out'       ? styles.statusSoldOut   :
                  r.status === 'Stagnant'       ? styles.statusStagnant  :
                  r.status === 'No recent data' ? styles.statusNoData    :
                  r.status === 'Slowing'        ? styles.statusSlowing   :
                  styles.statusSelling
                }>
                  {r.status === 'Stagnant' && r.latestStock == null ? 'No stock data' : r.status}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Tab 3: Unmatched ──────────────────────────────────────────────────────────

function UnmatchedTab({
  activeReports,
  matchesByReport,
  onNavigate,
}: {
  activeReports: ActiveReport[]
  matchesByReport: Record<string, MatchData | null>
  onNavigate: (page: string) => void
}) {
  const unmatchedCount = activeReports.filter(r => matchesByReport[r.id] == null).length

  const rows: UnmatchedRow[] = useMemo(
    () => buildUnmatchedRows(activeReports, matchesByReport),
    [activeReports, matchesByReport]
  )

  const top50 = rows.slice(0, 50)
  const totalUnmatched = rows.reduce((s, r) => s + r.totalQty, 0)

  let cumQty = 0

  return (
    <div>
      {unmatchedCount > 0 && (
        <div className={`${styles.banner} ${styles.bannerAmber}`}>
          {unmatchedCount} report{unmatchedCount !== 1 ? 's' : ''} not matched yet — excluded from unmatched analysis.
        </div>
      )}
      <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>
        Lines whose normalised name is not in any report's matches. Top 50 by units.
        Click Map to go to POS Mapping.
      </p>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Units</th>
              <th>Revenue</th>
              <th>Reports</th>
              <th>Cumulative %</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {top50.map(r => {
              cumQty += r.totalQty
              const cumPct = totalUnmatched > 0 ? (cumQty / totalUnmatched) * 100 : 0
              return (
                <tr key={r.normalisedName}>
                  <td>{r.origName}</td>
                  <td>{fmtNum(r.totalQty)}</td>
                  <td>{r.totalRevenue > 0 ? fmtMoney(r.totalRevenue) : '—'}</td>
                  <td>{r.reportCount}</td>
                  <td>
                    <span className={styles.cumBar} style={{ width: `${Math.min(cumPct, 100)}px` }} />
                    {cumPct.toFixed(0)}%
                  </td>
                  <td>
                    <button
                      className={`${styles.btnSmall} ${styles.btnOutline}`}
                      onClick={() => onNavigate('pos-mapping')}
                    >
                      Map
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function SalesReportsPage({
  venueId,
  canManage,
  onNavigate,
}: {
  venueId: string
  canManage?: boolean
  onNavigate: (page: string) => void
}) {
  const [tab, setTab]                         = useState<TabKey>('reports')
  const [loading, setLoading]                 = useState(true)
  const [allDocs, setAllDocs]                 = useState<RawDoc[]>([])
  const [matchesByReport, setMatchesByReport] = useState<Record<string, MatchData | null>>({})
  const [stockMap, setStockMap]               = useState<Record<string, StockEntry>>({})
  const [dataVersion, setDataVersion]         = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    async function load() {
      // 1. All salesReports
      const snap = await getDocs(collection(db, 'venues', venueId, 'salesReports'))
      if (cancelled) return
      const docs: RawDoc[] = snap.docs.map(d => ({ id: d.id, data: () => d.data() }))
      setAllDocs(docs)

      const { reports } = partitionReports(docs)

      // 2. Matches for each active report
      const mByR: Record<string, MatchData | null> = {}
      await Promise.all(reports.map(async r => {
        let matchDoc = await getDoc(doc(db, 'venues', venueId, 'salesReportMatches', r.id))
        if (!matchDoc.exists()) {
          const q2 = await getDocs(
            query(
              collection(db, 'venues', venueId, 'salesReportMatches'),
              where('reportId', '==', r.id),
              limit(1),
            )
          )
          if (!q2.empty) matchDoc = q2.docs[0] as any
        }
        if (!matchDoc.exists()) { mByR[r.id] = null; return }
        const md = matchDoc.data()
        const matches = md.matches ?? []
        mByR[r.id] = {
          matched: md.counts?.matched ?? matches.length,
          total:   md.counts?.total   ?? r.lineCount,
          matchedRevenue: matches.reduce((s: number, m: any) => s + (m.gross ?? 0), 0),
          matchedQty:     matches.reduce((s: number, m: any) => s + (m.qtySold ?? 0), 0),
          matches,
        }
      }))
      if (cancelled) return
      setMatchesByReport(mByR)

      // 3. Snapshots for stock
      const deptsSnap = await getDocs(collection(db, 'venues', venueId, 'departments'))
      const allSnaps: { cycleNumber: number; items: any[] }[] = []
      await Promise.all(deptsSnap.docs.map(async deptDoc => {
        const snapsSnap = await getDocs(
          query(
            collection(db, 'venues', venueId, 'departments', deptDoc.id, 'snapshots'),
            orderBy('cycleNumber', 'asc'),
          )
        )
        for (const sDoc of snapsSnap.docs) {
          const s = sDoc.data()
          allSnaps.push({ cycleNumber: s.cycleNumber ?? 0, items: s.items ?? [] })
        }
      }))

      if (cancelled) return

      // Build stock map: latest actualClosing per product
      const sm: Record<string, StockEntry> = {}
      for (const s of allSnaps) {
        for (const item of s.items) {
          if (!item.productId) continue
          if (item.actualClosing != null) {
            const ex = sm[item.productId]
            if (!ex || s.cycleNumber > ex.cycleNumber) {
              sm[item.productId] = { count: item.actualClosing, cycleNumber: s.cycleNumber }
            }
          }
        }
      }
      setStockMap(sm)
      setLoading(false)
    }

    load().catch(console.error)
    return () => { cancelled = true }
  }, [venueId, dataVersion])

  const { reports: activeReports } = useMemo(() => partitionReports(allDocs), [allDocs])
  const allReports = useMemo(() => mapAllReports(allDocs), [allDocs])
  const activeOnly = useMemo(
    () => activeReports.filter(r => isReportActive({ status: r.status })),
    [activeReports]
  )

  if (loading) return <div className={styles.page}><p className={styles.loading}>Loading sales reports…</p></div>

  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>Sales Reports</h1>
      <p className={styles.subheading}>
        {allDocs.length} report{allDocs.length !== 1 ? 's' : ''} in collection
        {' · '}{activeOnly.length} active
      </p>

      <div className={styles.tabs}>
        {([
          { key: 'reports',   label: 'Reports' },
          { key: 'velocity',  label: 'Velocity' },
          { key: 'unmatched', label: 'Unmatched' },
        ] as const).map(t => (
          <button
            key={t.key}
            className={`${styles.tab} ${tab === t.key ? styles.tabActive : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'reports' && (
        <ReportsTab
          allReports={allReports}
          matchesByReport={matchesByReport}
          canManage={canManage ?? false}
          onDataChange={() => setDataVersion(v => v + 1)}
          venueId={venueId}
        />
      )}

      {tab === 'velocity' && (
        <VelocityTab
          activeReports={activeOnly}
          matchesByReport={matchesByReport}
          stockMap={stockMap}
        />
      )}

      {tab === 'unmatched' && (
        <UnmatchedTab
          activeReports={activeOnly}
          matchesByReport={matchesByReport}
          onNavigate={onNavigate}
        />
      )}
    </div>
  )
}
