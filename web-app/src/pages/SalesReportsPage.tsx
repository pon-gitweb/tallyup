import { useEffect, useState, useMemo } from 'react'
import {
  collection, getDocs, getDoc, doc,
  query, where, orderBy, limit,
} from 'firebase/firestore'
import { db } from '../firebase'
import { isReportActive } from '../utils/isReportActive'
import {
  toNZDate, weekMonday, daySpan,
  partitionReports,
  buildVelocityRowsFromReports,
  buildUnmatchedRows,
  normName,
  NZ_TZ,
  type ActiveReport,
  type MatchData,
  type StockEntry,
  type VelocityRow,
  type UnmatchedRow,
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
    case 'bustle_rich':  return { label: 'GP per product',     title: 'Bustle rich GP export' }
    case 'bustle_items': return { label: 'Sales by category',  title: 'Bustle items export' }
    case 'pdf':          return { label: 'PDF',                title: 'PDF import' }
    default:             return { label: 'Legacy',             title: 'Legacy format — re-import to see format badge' }
  }
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

// ── 26-week strip ─────────────────────────────────────────────────────────────

function buildStrip(allDocs: RawDoc[]): Array<{ monday: string; state: 'present' | 'partial' | 'missing' | 'voided' }> {
  const todayNZ = new Date().toLocaleDateString('en-CA', { timeZone: NZ_TZ })
  const currentMon = weekMonday(todayNZ)

  const weeks: string[] = []
  let d = new Date(currentMon + 'T00:00:00Z')
  for (let i = 0; i < 26; i++) {
    weeks.unshift(new Date(d.getTime() - i * 7 * 86_400_000).toISOString().slice(0, 10))
  }

  return weeks.map(mon => {
    const sun = new Date(new Date(mon + 'T00:00:00Z').getTime() + 6 * 86_400_000).toISOString().slice(0, 10)

    let totalCoveredDays = 0
    let voidedOnly = true
    let hasActive = false

    for (const snap of allDocs) {
      const d2 = snap.data()
      const startStr = d2.report?.period?.start ?? toNZDate(d2.periodStart)
      const endStr   = d2.report?.period?.end   ?? toNZDate(d2.periodEnd)
      if (!startStr || !endStr) continue
      if (startStr > sun || endStr < mon) continue

      // Overlaps this week
      const overlapStart = startStr > mon ? startStr : mon
      const overlapEnd   = endStr < sun   ? endStr   : sun
      const days = daySpan(overlapStart, overlapEnd)

      if (isReportActive(d2)) {
        totalCoveredDays += days
        hasActive = true
        voidedOnly = false
      } else if (d2.status === 'voided') {
        totalCoveredDays += days
      } else {
        // superseded
        voidedOnly = false
      }
    }

    if (totalCoveredDays === 0) return { monday: mon, state: 'missing' as const }
    if (!hasActive && voidedOnly) return { monday: mon, state: 'voided' as const }
    if (totalCoveredDays >= 7) return { monday: mon, state: 'present' as const }
    return { monday: mon, state: 'partial' as const }
  })
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
    <div className={styles.modalOverlay} onClick={onClose}>
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
          <button className={styles.btnSecondary} onClick={onClose}>Cancel</button>
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

// ── Tab 1: Reports ────────────────────────────────────────────────────────────

function ReportsTab({
  allDocs,
  reports,
  matchesByReport,
  canManage,
  onDataChange,
  venueId,
}: {
  allDocs: RawDoc[]
  reports: ActiveReport[]
  matchesByReport: Record<string, MatchData | null>
  canManage: boolean
  onDataChange: () => void
  venueId: string
}) {
  const [drawerReport, setDrawerReport] = useState<ActiveReport | null>(null)
  const [voidReport, setVoidReport]     = useState<ActiveReport | null>(null)

  const strip = useMemo(() => buildStrip(allDocs), [allDocs])

  // Newest first
  const sorted = useMemo(
    () => [...reports].sort((a, b) => (b.startMs ?? 0) - (a.startMs ?? 0)),
    [reports]
  )

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
            {sorted.map(r => {
              const md = matchesByReport[r.id]
              const sf = sourceFormatLabel(r.meta?.sourceFormat)
              const hasLineTotals = r.meta?.lineTotalsBasis === 'line_total'
              const hasMeta = !!r.meta?.sourceFormat
              const st = reportStatus(r)

              const grossSum = hasLineTotals
                ? r.rawLines.reduce((s, l) => s + (l.grossIncl ?? l.gross ?? 0), 0)
                : null
              const netSum = hasLineTotals
                ? r.rawLines.reduce((s, l) => s + (l.netExcl ?? l.net ?? 0), 0)
                : null

              return (
                <tr key={r.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {fmtDate(r.startStr)}<br />
                    <span style={{ color: '#9ca3af', fontSize: 11 }}>→ {fmtDate(r.endStr)}</span>
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
                    {hasLineTotals && netSum != null && netSum > 0
                      ? fmtMoney(netSum)
                      : hasLineTotals ? '—' : <span style={{ color: '#9ca3af', fontSize: 11 }}>legacy</span>
                    }
                  </td>
                  <td style={{ fontSize: 11, color: '#6b7280' }}>{gstBasisLabel(r.meta?.gstBasis)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {md
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
                    {canManage && st === 'active' && (
                      <button
                        className={`${styles.btnSmall} ${styles.btnDanger}`}
                        onClick={() => setVoidReport(r)}
                      >
                        Void
                      </button>
                    )}
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

  const rows: VelocityRow[] = useMemo(
    () => buildVelocityRowsFromReports(activeReports, matchesByReport, stockMap, todayNZ),
    [activeReports, matchesByReport, stockMap, todayNZ]
  )

  // Banner metrics
  const allWeekSet = useMemo(() => {
    const s = new Set<string>()
    for (const r of activeReports) {
      if (!r.startStr || !r.endStr) continue
      let cur = new Date(r.startStr + 'T00:00:00Z')
      const end = new Date(r.endStr + 'T00:00:00Z')
      while (cur <= end) {
        const wk = weekMonday(cur.toISOString().slice(0, 10))
        if (wk < weekMonday(todayNZ)) s.add(wk)
        cur = new Date(cur.getTime() + 7 * 86_400_000)
      }
    }
    return s
  }, [activeReports, todayNZ])

  const sortedWeeks = [...allWeekSet].sort()
  const last6 = sortedWeeks.slice(-6)
  const missingWeeks: string[] = []
  if (last6.length > 0) {
    let cur = new Date(last6[0] + 'T00:00:00Z')
    const end = new Date(last6[last6.length - 1] + 'T00:00:00Z')
    while (cur <= end) {
      const wk = cur.toISOString().slice(0, 10)
      if (!allWeekSet.has(wk)) missingWeeks.push(wk)
      cur = new Date(cur.getTime() + 7 * 86_400_000)
    }
  }

  const totalMatched   = activeReports.reduce((s, r) => s + (matchesByReport[r.id]?.matched ?? 0), 0)
  const totalLines     = activeReports.reduce((s, r) => s + r.lineCount, 0)
  const matchedUnits   = activeReports.reduce((s, r) => s + (matchesByReport[r.id]?.matchedQty ?? 0), 0)
  const totalUnits     = activeReports.reduce((s, r) => s + r.totalQtySold, 0)
  const limitedHistory = sortedWeeks.length < 6

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      if (sortKey === 'last4')   return b.last4Units - a.last4Units
      if (sortKey === 'change')  return (b.changePct ?? -Infinity) - (a.changePct ?? -Infinity)
      // status sort: Sold out > Stagnant > Slowing > Selling
      const order: Record<string, number> = { 'Sold out': 0, 'Stagnant': 1, 'Slowing': 2, 'Selling': 3 }
      return (order[a.status] ?? 4) - (order[b.status] ?? 4)
    })
  }, [rows, sortKey])

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
      {limitedHistory && (
        <div className={`${styles.banner} ${styles.bannerAmber}`}>
          Limited history — only {sortedWeeks.length} week(s) of matched data.
        </div>
      )}
      <div className={`${styles.banner} ${styles.bannerGray}`}>
        {sortedWeeks.length} weeks covered
        {missingWeeks.length > 0 && ` · missing: ${missingWeeks.join(', ')}`}
        {' · '}match coverage: {totalMatched}/{totalLines} lines, {matchedUnits}/{totalUnits} units
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
                  r.status === 'Sold out'  ? styles.statusSoldOut  :
                  r.status === 'Stagnant'  ? styles.statusStagnant :
                  r.status === 'Slowing'   ? styles.statusSlowing  :
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
  const rows: UnmatchedRow[] = useMemo(
    () => buildUnmatchedRows(activeReports, matchesByReport),
    [activeReports, matchesByReport]
  )

  const top50 = rows.slice(0, 50)
  const totalUnmatched = rows.reduce((s, r) => s + r.totalQty, 0)

  let cumQty = 0

  return (
    <div>
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
          allDocs={allDocs}
          reports={activeReports}
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
