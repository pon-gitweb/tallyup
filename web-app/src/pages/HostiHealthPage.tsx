import { useEffect, useMemo, useState } from 'react'
import { collection, doc, getDoc, getDocs, limit, orderBy, query, where } from 'firebase/firestore'
import {
  ComposedChart, LineChart, Line, Area, BarChart, Bar, Cell, LabelList,
  XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer,
} from 'recharts'
import { db } from '../firebase'
import { theme } from '../theme'
import {
  CHART_TOOLTIP_STYLE, CHART_GRID_PROPS, CHART_AXIS_TICK, CHART_DOT,
  CHART_ACTIVE_DOT, CHART_ANIMATION, CHART_HEIGHT_LINE, CHART_HEIGHT_BAR,
} from '../chartConfig'
import { ChartEmptyState } from '../components/ChartEmptyState'
import { getHostiHealthStage } from '../services/hostiHealth'
import type { HostiHealthData, HostiHealthStage3 } from '../services/hostiHealth'
import styles from './HostiHealthPage.module.css'

// ─── Types ────────────────────────────────────────────────────────────────────

type KpiScores = {
  stockAccuracy: number | null
  labourEfficiency: number | null
  inventoryHealth: number | null
  orderingIntelligence: number | null
}

type HistoryPoint = {
  monthKey: string
  score: number
  variancePct: number | null
  stockAccuracy: number | null
  calculatedAt: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function scoreColor(score: number | null): string {
  if (score == null) return theme.slateMid
  if (score >= 90) return theme.deepBlue
  if (score >= 75) return theme.success
  if (score >= 60) return theme.amber
  if (score >= 40) return '#f97316'
  return theme.error
}

function scoreLabel(score: number | null): string {
  if (score == null) return '—'
  if (score >= 90) return 'Excellent'
  if (score >= 75) return 'Strong'
  if (score >= 60) return 'Developing'
  if (score >= 40) return 'Needs attention'
  return 'At risk'
}

function kpiColor(score: number | null): string {
  if (score == null) return '#e5e3de'
  if (score >= 80) return theme.deepBlue
  if (score >= 60) return theme.amber
  return theme.error
}

function fmtMoney(v: number | null): string {
  if (v == null) return '—'
  const abs = Math.abs(v)
  return (v < 0 ? '-' : '') + '$' + Math.round(abs).toLocaleString('en-NZ')
}

function fmtTimestamp(ms: number | null): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleDateString('en-NZ', { day: '2-digit', month: 'short', year: 'numeric' })
}

function fmtMonth(key: string): string {
  const [year, month] = key.split('-')
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${months[(parseInt(month, 10) || 0) - 1] ?? ''} ${year}`
}

function fmtMonthShort(key: string): string {
  const [, month] = key.split('-')
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return months[(parseInt(month, 10) || 0) - 1] ?? key
}

function severityBadgeStyle(severity: string): React.CSSProperties {
  switch (severity?.toLowerCase()) {
    case 'high':     return { background: '#fee2e2', color: '#991b1b' }
    case 'medium':   return { background: '#fef3c7', color: '#92400e' }
    case 'positive': return { background: '#dcfce7', color: '#166534' }
    default:         return { background: '#f3f4f6', color: '#6B7280' }
  }
}

function confidenceBadgeStyle(label: string | null): React.CSSProperties {
  const l = (label ?? '').toLowerCase()
  if (l === 'high')   return { background: '#dcfce7', color: '#166534' }
  if (l === 'medium') return { background: '#fef3c7', color: '#92400e' }
  return { background: '#f3f4f6', color: '#6B7280' }
}

function constraintImpactStyle(impact: string | null): React.CSSProperties {
  switch ((impact ?? '').toLowerCase()) {
    case 'high':   return { background: '#fee2e2', color: '#991b1b' }
    case 'medium': return { background: '#fef3c7', color: '#92400e' }
    default:       return { background: '#f3f4f6', color: '#6B7280' }
  }
}

const KPI_META: { key: keyof KpiScores; label: string; desc: string }[] = [
  { key: 'stockAccuracy',       label: 'Stock Accuracy',       desc: 'Dollar variance vs expected stock value' },
  { key: 'labourEfficiency',    label: 'Labour Efficiency',    desc: 'Counting time vs your baseline' },
  { key: 'inventoryHealth',     label: 'Inventory Health',     desc: 'Days of cover in healthy range' },
  { key: 'orderingIntelligence',label: 'Ordering Intelligence',desc: 'Acting on suggested orders' },
]

// ─── Component ────────────────────────────────────────────────────────────────

export default function HostiHealthPage({ venueId, onNavigate }: { venueId: string; onNavigate?: (page: string) => void }) {
  const [health, setHealth] = useState<HostiHealthData | null>(null)
  const [healthLoading, setHealthLoading] = useState(true)
  const [history, setHistory] = useState<HistoryPoint[]>([])
  const [unmappedCount, setUnmappedCount] = useState(0)

  useEffect(() => {
    if (!venueId) return
    getDocs(query(
      collection(db, 'venues', venueId, 'salesReportUnknowns'),
      where('status', '==', 'unmapped'),
      limit(50)
    )).then(snap => setUnmappedCount(snap.size)).catch(() => {})
  }, [venueId])

  useEffect(() => {
    if (!venueId) return
    let alive = true
    setHealthLoading(true)

    async function load() {
      try {
        const venueSnap = await getDoc(doc(db, 'venues', venueId))
        const venueData = venueSnap.exists() ? (venueSnap.data() as any) : {}
        const totalStocktakesCompleted = venueData?.totalStocktakesCompleted || 0

        const productsSnap = await getDocs(collection(db, 'venues', venueId, 'products'))

        const suppliersSnap = await getDocs(collection(db, 'venues', venueId, 'suppliers'))
        let supplierCount = 0
        suppliersSnap.forEach(d => { if (!(d.data() as any)?.isHoldingSupplier) supplierCount++ })

        let stockValue: number | null = null
        try {
          const latestSnap = await getDoc(doc(db, 'venues', venueId, 'latestSnapshot', 'current'))
          if (latestSnap.exists()) {
            const depts = (latestSnap.data() as any)?.departments ?? []
            stockValue = depts.reduce((sum: number, d: any) =>
              sum + ((d?.summary?.displayTotalStockValue ?? d?.summary?.totalStockValue) ?? 0), 0)
          }
        } catch {}

        const data = await getHostiHealthStage(venueId, totalStocktakesCompleted, productsSnap.size, supplierCount, stockValue)

        // Read history after computation so the point just written is included.
        // Ordered by doc ID (YYYY-MM) which sorts chronologically as a string.
        const histSnap = await getDocs(query(
          collection(db, 'venues', venueId, 'hostiHealthHistory'),
          orderBy('__name__', 'asc'),
        ))
        const histPoints: HistoryPoint[] = histSnap.docs.map(d => {
          const hd = d.data() as any
          return {
            monthKey: d.id,
            score: hd.score ?? 0,
            variancePct: hd.variancePct ?? null,
            stockAccuracy: hd.stockAccuracy ?? null,
            calculatedAt: hd.calculatedAt ?? 0,
          }
        })

        if (alive) {
          setHealth(data)
          setHistory(histPoints)
        }
      } catch (e) {
        console.error('HostiHealthPage:load', e)
        if (alive) setHealth(null)
      } finally {
        if (alive) setHealthLoading(false)
      }
    }

    load()
    return () => { alive = false }
  }, [venueId])

  // Stage 3 is the only stage that shows the full dashboard
  const current: HostiHealthStage3 | null = health?.stage === 3 ? health as HostiHealthStage3 : null

  // Chart A: score trend from append-only history collection
  const trendData = useMemo(() =>
    history
      .filter(h => h.score != null)
      .map(h => ({ month: fmtMonthShort(h.monthKey), fullMonth: fmtMonth(h.monthKey), score: h.score })),
  [history])

  // Chart B: KPI breakdown
  const kpiBarData = useMemo(() =>
    KPI_META.map((m) => {
      const raw = current?.kpis?.[m.key as keyof typeof current.kpis]
      const numVal = typeof raw === 'number' ? raw : null
      return {
        name: m.label,
        shortName: m.label.replace(' Intelligence', ' Intel.').replace(' Efficiency', ' Eff.'),
        value: numVal ?? 0,
        hasData: numVal != null,
      }
    }),
  [current])

  // Chart C: variance rate from append-only history collection
  const varianceRateData = useMemo(() =>
    history
      .filter(h => h.variancePct != null)
      .map(h => ({ month: fmtMonthShort(h.monthKey), fullMonth: fmtMonth(h.monthKey), rate: h.variancePct! })),
  [history])

  if (healthLoading) return <p className={styles.loading}>Loading Hosti Health…</p>

  if (!healthLoading && (health === null || health.stage < 3)) {
    const stage2 = health?.stage === 2 ? health : null
    return (
      <div className={styles.emptyState}>
        <div className={styles.emptyLogo}>H</div>
        <h1 className={styles.emptyTitle}>Hosti Health not yet calculated</h1>
        <p className={styles.emptyBody}>
          {stage2
            ? `Your score is building — ${stage2.completedStocktakes} of 3 stocktakes done. One more and your full dashboard unlocks.`
            : `Your score appears after your third stocktake. Head to the app whenever you're ready.`
          }
        </p>
        <p className={styles.emptyNote}>
          It updates automatically each time you complete a stocktake.
        </p>
      </div>
    )
  }

  return (
    <div className={styles.page}>

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

      {/* ── ROW 1: Hero + KPI grid ── */}
      <div className={`${styles.row} ${styles.heroRow}`}>

        {/* Score hero card */}
        <div className={styles.scoreCard}>
          <p className={styles.scoreNumber} style={{ color: scoreColor(current?.score ?? null) }}>
            {current?.score ?? '—'}
            <span className={styles.scoreOutOf}>/100</span>
          </p>
          <p className={styles.scoreLabel} style={{ color: scoreColor(current?.score ?? null) }}>
            {scoreLabel(current?.score ?? null)}
          </p>
          {current?.confidence && (
            <span className={styles.badge} style={confidenceBadgeStyle(current.confidence)}>
              {current.confidence}
            </span>
          )}
          <p className={styles.scoreMeta}>
            Last calculated {fmtTimestamp(current?.calculatedAt ?? null)}
          </p>
          {(current?.estimatedImpact ?? 0) > 0 && (
            <p className={styles.scoreImpact} style={{ color: theme.success }}>
              Est. {fmtMoney(current!.estimatedImpact!)} recovered this cycle
            </p>
          )}
          {current?.operationalStockValue != null && (
            <p className={styles.scoreMeta}>
              Operational stock value: {fmtMoney(current.operationalStockValue)}
            </p>
          )}
        </div>

        {/* KPI 2x2 grid */}
        <div className={styles.kpiGrid}>
          {KPI_META.map((m) => {
            const raw = current?.kpis?.[m.key as keyof typeof current.kpis]
            const score: number | null = typeof raw === 'number' ? raw : null
            const color = kpiColor(score)
            return (
              <div key={m.key} className={styles.kpiCard}>
                <p className={styles.kpiLabel}>{m.label}</p>
                <p className={`${styles.kpiScore} ${score == null ? styles.kpiScoreNull : ''}`}
                   style={{ color: score != null ? color : '#9ca3af' }}>
                  {score != null ? Math.round(score) : '—'}
                  {score != null && <span style={{ fontSize: 16, color: '#9ca3af', fontWeight: 400 }}>/100</span>}
                </p>
                <div className={styles.progressBar}>
                  <div
                    className={styles.progressFill}
                    style={{ width: `${score ?? 0}%`, background: color }}
                  />
                </div>
                <p className={styles.kpiDesc}>
                  {score != null ? m.desc : 'Not enough data yet'}
                </p>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── ROW 2: Charts ── */}
      <div className={`${styles.row} ${styles.chartRow}`}>

        {/* Chart A: Score trend */}
        <div className={styles.chartCard}>
          <p className={styles.chartTitle}>Score trend</p>
          {trendData.length < 2 ? (
            <ChartEmptyState
              icon="📈"
              title={trendData.length === 1
                ? `${trendData[0].score}/100 — ${trendData[0].fullMonth}`
                : 'Building history'
              }
              body="Complete more stocktakes over time to see your score trend."
              height={CHART_HEIGHT_LINE}
            />
          ) : (
            <ResponsiveContainer width="100%" height={CHART_HEIGHT_LINE}>
              <ComposedChart data={trendData} margin={{ top: 8, right: 40, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="scoreGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={theme.deepBlue} stopOpacity={0.10} />
                    <stop offset="100%" stopColor={theme.deepBlue} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...CHART_GRID_PROPS} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: theme.slateMid, fontFamily: theme.fontBody }} axisLine={false} tickLine={false} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: theme.slateMid, fontFamily: theme.fontBody }} width={32} axisLine={false} tickLine={false} />
                <ReferenceLine y={75} stroke={theme.success} strokeDasharray="4 3" strokeWidth={1}
                  label={{ value: 'Strong', fontSize: 10, fill: theme.success, position: 'right' }} />
                <ReferenceLine y={60} stroke={theme.amber} strokeDasharray="4 3" strokeWidth={1}
                  label={{ value: 'Developing', fontSize: 10, fill: theme.amber, position: 'right' }} />
                <Tooltip
                  contentStyle={{ background: theme.white, border: `1px solid ${theme.border}`, borderRadius: 10, fontSize: 13, fontFamily: theme.fontBody, boxShadow: '0 4px 16px rgba(11,19,43,0.08)', padding: '10px 14px', color: theme.navy }}
                  formatter={((v: number) => [`${v}/100`, 'Score']) as any}
                  labelFormatter={((m: string) => trendData.find((d) => d.month === m)?.fullMonth ?? m) as any}
                  cursor={{ stroke: '#e5e3de', strokeWidth: 1 }} />
                <Area type="monotone" dataKey="score" stroke="none" fill="url(#scoreGradient)" {...CHART_ANIMATION} />
                <Line type="monotone" dataKey="score" stroke={theme.deepBlue} strokeWidth={2.5}
                  dot={CHART_DOT} activeDot={{ ...CHART_ACTIVE_DOT, fill: theme.deepBlue }} {...CHART_ANIMATION} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Chart B: KPI breakdown */}
        <div className={styles.chartCard}>
          <p className={styles.chartTitle}>KPI breakdown</p>
          <ResponsiveContainer width="100%" height={CHART_HEIGHT_BAR}>
            <BarChart data={kpiBarData} layout="vertical" margin={{ top: 4, right: 48, left: 0, bottom: 0 }}>
              <CartesianGrid {...CHART_GRID_PROPS} horizontal={false} vertical={false} />
              <YAxis type="category" dataKey="shortName" width={96} tick={CHART_AXIS_TICK} axisLine={false} tickLine={false} />
              <XAxis type="number" domain={[0, 100]} tick={CHART_AXIS_TICK} axisLine={false} tickLine={false} />
              <ReferenceLine x={75} stroke={theme.success} strokeDasharray="4 3" strokeWidth={1} />
              <Tooltip contentStyle={CHART_TOOLTIP_STYLE}
                formatter={((v: number, _: string, p: any) => [
                  p?.payload?.hasData ? `${v}/100` : 'No data',
                  p?.payload?.name ?? '',
                ]) as any}
                labelFormatter={(() => '') as any}
                cursor={{ fill: 'rgba(11,19,43,0.03)' }} />
              <Bar dataKey="value" radius={[0, 4, 4, 0]} {...CHART_ANIMATION}>
                {kpiBarData.map((entry, i) => (
                  <Cell key={i} fill={entry.hasData ? kpiColor(entry.value) : '#e5e3de'} />
                ))}
                <LabelList dataKey="value" position="right" fontSize={11}
                  formatter={((v: number) => v > 0 ? `${v}` : '') as any}
                  style={{ fill: theme.slateMid, fontFamily: theme.fontBody }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Chart C: Variance rate */}
        <div className={styles.chartCard}>
          <p className={styles.chartTitle}>Variance rate</p>
          {varianceRateData.length < 2 ? (
            <ChartEmptyState
              icon="📉"
              title="No trend yet"
              body="Your variance rate trend appears after two stocktakes. The lower the line the better."
              height={CHART_HEIGHT_LINE}
            />
          ) : (
            <ResponsiveContainer width="100%" height={CHART_HEIGHT_LINE}>
              <LineChart data={varianceRateData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid {...CHART_GRID_PROPS} />
                <XAxis dataKey="month" tick={CHART_AXIS_TICK} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={(v: number) => `${v}%`} tick={CHART_AXIS_TICK} width={38} axisLine={false} tickLine={false} />
                <ReferenceLine y={2} stroke={theme.success} strokeDasharray="4 3" strokeWidth={1}
                  label={{ value: 'Healthy <2%', fontSize: 10, fill: theme.success, position: 'right' }} />
                <Tooltip contentStyle={CHART_TOOLTIP_STYLE}
                  formatter={((v: number) => [`${v}%`, 'Variance rate']) as any}
                  labelFormatter={((m: string) => varianceRateData.find((d) => d.month === m)?.fullMonth ?? m) as any}
                  cursor={{ stroke: theme.border, strokeWidth: 1 }} />
                <Line type="monotone" dataKey="rate" stroke={theme.error} strokeWidth={2.5}
                  dot={CHART_DOT} activeDot={{ ...CHART_ACTIVE_DOT, fill: theme.error }} {...CHART_ANIMATION} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* ── ROW 3: Insight cards ── */}
      <div className={`${styles.row} ${styles.insightRow}`}>

        {/* Card A: Focus List */}
        <div className={styles.insightCard}>
          <p className={styles.insightTitle}>Focus List</p>
          <p className={styles.insightSubtitle}>Top variance drivers this cycle</p>
          {current?.paretoItems?.slice(0, 3)?.length ? (
            <>
              {current.paretoItems.slice(0, 3).map((item, i) => (
                <div key={i} className={styles.paretoItem}>
                  <span className={styles.paretoRank}>{i + 1}.</span>
                  <div className={styles.paretoBody}>
                    <p className={styles.paretoName}>{item.name}</p>
                    {item.areaName && <p className={styles.paretoArea}>{item.areaName}</p>}
                  </div>
                  <div className={styles.paretoRight}>
                    <p className={styles.paretoVariance}
                       style={{ color: item.varianceDollars < 0 ? theme.error : theme.success }}>
                      {item.varianceDollars < 0 ? '−' : '+'}${Math.abs(Math.round(item.varianceDollars)).toLocaleString('en-NZ')}
                    </p>
                    <p className={styles.paretoPct}>{item.contributionPct}%</p>
                  </div>
                </div>
              ))}
              <p className={styles.focusNote}>Fix these first. Everything else is secondary.</p>
            </>
          ) : (
            <p className={styles.insightEmpty}>No variance data yet — complete a stocktake to see your Focus List.</p>
          )}
        </div>

        {/* Card B: Primary Insight */}
        <div className={styles.insightCard}>
          <p className={styles.insightTitle}>Primary Insight</p>
          {current?.abductiveInsights?.[0] ? (
            <>
              <span className={styles.badge} style={severityBadgeStyle(current.abductiveInsights[0].severity)}>
                {current.abductiveInsights[0].severity.charAt(0).toUpperCase() + current.abductiveInsights[0].severity.slice(1)}
              </span>
              <p className={styles.insightPattern}>{current.abductiveInsights[0].pattern}</p>
              <p className={styles.insightExplanation}>
                <span style={{ color: theme.slateMid }}>Most likely: </span>
                {current.abductiveInsights[0].mostLikelyExplanation}
              </p>
              <span className={styles.badge} style={confidenceBadgeStyle(current.abductiveInsights[0].confidenceLabel)}>
                {current.abductiveInsights[0].confidenceLabel} confidence
              </span>
              <p className={styles.insightActionable}>→ {current.abductiveInsights[0].actionable}</p>
            </>
          ) : (
            <p className={styles.insightEmpty}>Complete 2+ stocktakes to unlock pattern insights.</p>
          )}
        </div>

        {/* Card C: Primary Constraint */}
        <div className={styles.insightCard}>
          <p className={styles.insightTitle}>Primary Constraint</p>
          {current?.constraint?.description ? (
            <>
              {current.constraint.impact && (
                <span className={styles.badge} style={constraintImpactStyle(current.constraint.impact)}>
                  {current.constraint.impact.charAt(0).toUpperCase() + current.constraint.impact.slice(1)} impact
                </span>
              )}
              <p className={styles.constraintDesc}>{current.constraint.description}</p>
              {current.constraint.fixAction && (
                <p className={styles.constraintFix}>→ {current.constraint.fixAction}</p>
              )}
              {current.daysOfCover != null && (
                <p className={styles.constraintDays}>
                  Days of cover: {current.daysOfCover} days
                  {current.targetDaysOfCover != null ? ` (target: ${current.targetDaysOfCover} days)` : ''}
                </p>
              )}
            </>
          ) : (
            <p className={styles.insightEmpty}>No constraints identified — your operations look healthy.</p>
          )}
        </div>
      </div>
    </div>
  )
}
