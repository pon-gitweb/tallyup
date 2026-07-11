import { useEffect, useMemo, useState } from 'react'
import { collection, getDocs, orderBy, query } from 'firebase/firestore'
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
import styles from './HostiHealthPage.module.css'

// ─── Types ────────────────────────────────────────────────────────────────────

type KpiScores = {
  stockAccuracy: number | null
  labourEfficiency: number | null
  inventoryHealth: number | null
  orderingIntelligence: number | null
}

type ParetoItem = {
  name: string
  varianceDollars: number
  contributionPct: number
  areaName: string | null
  categoryName: string | null
}

type TopInsight = {
  pattern: string
  mostLikelyExplanation: string
  confidence: number
  confidenceLabel: string
  actionable: string
  severity: string
}

type HealthSnapshot = {
  monthKey: string
  score: number | null
  confidence: string | null
  kpiScores: KpiScores | null
  estimatedImpact: number | null
  stockValue: number | null
  varianceDollars: number | null
  paretoTop3: ParetoItem[]
  paretoTotalVariance: number | null
  topInsight: TopInsight | null
  constraintType: string | null
  constraintDescription: string | null
  constraintFixAction: string | null
  constraintImpact: string | null
  daysOfCover: number | null
  targetDaysOfCover: number | null
  operationalStockValue: number | null
  cellarStockValue: number | null
  calculatedAt: number | null
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

function docToSnapshot(id: string, data: any): HealthSnapshot {
  const insight = Array.isArray(data.abductiveInsights) && data.abductiveInsights.length > 0
    ? data.abductiveInsights[0]
    : null
  return {
    monthKey: id,
    score: data.score ?? null,
    confidence: data.confidence ?? null,
    kpiScores: data.kpis ? {
      stockAccuracy:       data.kpis.stockAccuracy ?? null,
      labourEfficiency:    data.kpis.labourEfficiency ?? null,
      inventoryHealth:     data.kpis.inventoryHealth ?? null,
      orderingIntelligence: data.kpis.orderingIntelligence ?? null,
    } : null,
    estimatedImpact:     data.estimatedImpact ?? null,
    stockValue:          data.stockValue ?? null,
    varianceDollars:     data.varianceDollars ?? null,
    paretoTop3:          (Array.isArray(data.paretoItems) ? data.paretoItems : []).slice(0, 3).map((p: any) => ({
      name:             p.name ?? '—',
      varianceDollars:  p.varianceDollars ?? 0,
      contributionPct:  p.contributionPct ?? 0,
      areaName:         p.areaName ?? null,
      categoryName:     p.categoryName ?? null,
    })),
    paretoTotalVariance:  data.paretoTotalVariance ?? null,
    topInsight: insight ? {
      pattern:               insight.pattern ?? '',
      mostLikelyExplanation: insight.mostLikelyExplanation ?? '',
      confidence:            insight.confidence ?? 0,
      confidenceLabel:       insight.confidenceLabel ?? 'Low',
      actionable:            insight.actionable ?? '',
      severity:              insight.severity ?? 'low',
    } : null,
    constraintType:        data.constraint?.type ?? null,
    constraintDescription: data.constraint?.description ?? null,
    constraintFixAction:   data.constraint?.fixAction ?? null,
    constraintImpact:      data.constraint?.impact ?? null,
    daysOfCover:           data.daysOfCover ?? null,
    targetDaysOfCover:     data.targetDaysOfCover ?? null,
    operationalStockValue: data.operationalStockValue ?? null,
    cellarStockValue:      data.cellarStockValue ?? null,
    calculatedAt:          data.calculatedAt?.toMillis?.() ?? null,
  }
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

export default function HostiHealthPage({ venueId }: { venueId: string }) {
  const [snapshots, setSnapshots] = useState<HealthSnapshot[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    getDocs(
      query(
        collection(db, 'venues', venueId, 'profitRecoverySnapshots'),
        orderBy('__name__', 'asc'),
      ),
    ).then((snap) => {
      const rows = snap.docs.map((d) => docToSnapshot(d.id, d.data())).reverse() // most recent first
      setSnapshots(rows)
    }).catch(() => {
      setSnapshots([])
    }).finally(() => setLoading(false))
  }, [venueId])

  const current = snapshots[0] ?? null
  const chronological = useMemo(() => [...snapshots].reverse(), [snapshots]) // oldest first for charts

  // Chart A: score trend
  const trendData = useMemo(() =>
    chronological
      .filter((s) => s.score != null)
      .map((s) => ({ month: fmtMonthShort(s.monthKey), fullMonth: fmtMonth(s.monthKey), score: s.score! })),
  [chronological])

  // Chart B: KPI breakdown
  const kpiBarData = useMemo(() =>
    KPI_META.map((m) => ({
      name: m.label,
      shortName: m.label.replace(' Intelligence', ' Intel.').replace(' Efficiency', ' Eff.'),
      value: current?.kpiScores?.[m.key] ?? 0,
      hasData: (current?.kpiScores?.[m.key] ?? null) != null,
    })),
  [current])

  // Chart C: variance rate trend
  const varianceRateData = useMemo(() =>
    chronological
      .filter((s) => s.varianceDollars != null && s.stockValue != null && s.stockValue > 0)
      .map((s) => ({
        month: fmtMonthShort(s.monthKey),
        fullMonth: fmtMonth(s.monthKey),
        rate: parseFloat((Math.abs(s.varianceDollars!) / s.stockValue! * 100).toFixed(2)),
      })),
  [chronological])

  if (loading) return <p className={styles.loading}>Loading Hosti Health…</p>

  if (snapshots.length === 0) {
    return (
      <div className={styles.emptyState}>
        <div className={styles.emptyLogo}>H</div>
        <h1 className={styles.emptyTitle}>Hosti Health not yet calculated</h1>
        <p className={styles.emptyBody}>
          Complete 3 stocktakes on the mobile app to unlock your performance score.
          Your score will appear here automatically after each stocktake.
        </p>
        <p className={styles.emptyNote}>
          Hosti Health updates each time you view the Performance screen on mobile.
        </p>
      </div>
    )
  }

  return (
    <div className={styles.page}>

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
            const score = current?.kpiScores?.[m.key] ?? null
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
          {trendData.length < 1 ? (
            <ChartEmptyState
              icon="📈"
              title="No score yet"
              body="Your Hosti Health score appears after your third stocktake. Each count makes it more accurate."
              height={CHART_HEIGHT_LINE}
            />
          ) : trendData.length === 1 ? (
            <ChartEmptyState
              icon="📈"
              title={`${trendData[0].score}/100 — ${trendData[0].fullMonth}`}
              body="Complete more stocktakes to see your score trend over time."
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
          {current?.paretoTop3?.length ? (
            <>
              {current.paretoTop3.map((item, i) => (
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
          {current?.topInsight ? (
            <>
              <span className={styles.badge} style={severityBadgeStyle(current.topInsight.severity)}>
                {current.topInsight.severity.charAt(0).toUpperCase() + current.topInsight.severity.slice(1)}
              </span>
              <p className={styles.insightPattern}>{current.topInsight.pattern}</p>
              <p className={styles.insightExplanation}>
                <span style={{ color: theme.slateMid }}>Most likely: </span>
                {current.topInsight.mostLikelyExplanation}
              </p>
              <span className={styles.badge} style={confidenceBadgeStyle(current.topInsight.confidenceLabel)}>
                {current.topInsight.confidenceLabel} confidence
              </span>
              <p className={styles.insightActionable}>→ {current.topInsight.actionable}</p>
            </>
          ) : (
            <p className={styles.insightEmpty}>Complete 2+ stocktakes to unlock pattern insights.</p>
          )}
        </div>

        {/* Card C: Primary Constraint */}
        <div className={styles.insightCard}>
          <p className={styles.insightTitle}>Primary Constraint</p>
          {current?.constraintDescription ? (
            <>
              {current.constraintImpact && (
                <span className={styles.badge} style={constraintImpactStyle(current.constraintImpact)}>
                  {current.constraintImpact.charAt(0).toUpperCase() + current.constraintImpact.slice(1)} impact
                </span>
              )}
              <p className={styles.constraintDesc}>{current.constraintDescription}</p>
              {current.constraintFixAction && (
                <p className={styles.constraintFix}>→ {current.constraintFixAction}</p>
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
