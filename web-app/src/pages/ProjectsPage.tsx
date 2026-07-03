import { useEffect, useRef, useState } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import type { User } from 'firebase/auth'
import { db } from '../firebase'
import styles from './ProjectsPage.module.css'

// ─── Types ────────────────────────────────────────────────────────────────────

type ParetoItem = {
  name: string
  varianceDollars: number
  contributionPct: number
  areaName: string | null
  categoryName: string | null
}

export type VenueRow = {
  id: string
  name: string
  venueType: string
  score: number | null
  scoreLabel: string | null
  varianceDollars: number | null
  stockValue: number | null
  estimatedImpact: number | null
  totalStocktakesCompleted: number | null
  lastCompletedAt: Date | null
  paretoTop10: ParetoItem[]
  prevParetoTop10: ParetoItem[]
  snapshotLoaded: boolean
}

// ─── Data loading ─────────────────────────────────────────────────────────────

async function loadVenues(uid: string): Promise<VenueRow[]> {
  const userSnap = await getDoc(doc(db, 'users', uid))
  const venueIds: string[] = userSnap.exists() ? (userSnap.data()?.venueIds ?? []) : []

  const rows = await Promise.all(
    venueIds.map(async (id) => {
      try {
        const venueSnap = await getDoc(doc(db, 'venues', id))
        if (!venueSnap.exists()) return null
        const data = venueSnap.data() as any
        if (data.deletedAt) return null

        const now = new Date()
        const monthKey = now.toISOString().slice(0, 7)
        const prevMonthKey = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 7)
        const twoMonthsBack = new Date(now.getFullYear(), now.getMonth() - 2, 1).toISOString().slice(0, 7)

        // Current snapshot: this month → prev month fallback
        let snapshot: any = null
        const snapDoc = await getDoc(doc(db, 'venues', id, 'profitRecoverySnapshots', monthKey))
        if (snapDoc.exists()) {
          snapshot = snapDoc.data()
        } else {
          const prevDoc = await getDoc(doc(db, 'venues', id, 'profitRecoverySnapshots', prevMonthKey))
          if (prevDoc.exists()) snapshot = prevDoc.data()
        }

        // Previous snapshot for trend comparison: prev month → two months back fallback
        let prevSnapshot: any = null
        const prevDoc2 = await getDoc(doc(db, 'venues', id, 'profitRecoverySnapshots', prevMonthKey))
        if (prevDoc2.exists()) {
          prevSnapshot = prevDoc2.data()
        } else {
          const prevDoc3 = await getDoc(doc(db, 'venues', id, 'profitRecoverySnapshots', twoMonthsBack))
          if (prevDoc3.exists()) prevSnapshot = prevDoc3.data()
        }

        const score: number | null = snapshot?.score ?? null
        const scoreLabel: string | null = score == null ? null :
          score >= 90 ? 'Excellent' :
          score >= 75 ? 'Strong' :
          score >= 60 ? 'Developing' :
          score >= 40 ? 'Needs attention' : 'At risk'

        return {
          id,
          name: data.name || 'Unnamed project',
          venueType: data.venueType || 'venue',
          score,
          scoreLabel,
          varianceDollars: snapshot?.varianceDollars ?? null,
          stockValue: snapshot?.stockValue ?? null,
          estimatedImpact: snapshot?.estimatedImpact ?? null,
          totalStocktakesCompleted: data.totalStocktakesCompleted ?? null,
          lastCompletedAt: data.lastCompletedAt?.toDate?.() ?? null,
          paretoTop10: snapshot?.paretoTop10 ?? snapshot?.paretoTop3 ?? [],
          prevParetoTop10: prevSnapshot?.paretoTop10 ?? prevSnapshot?.paretoTop3 ?? [],
          snapshotLoaded: snapshot != null,
        } as VenueRow
      } catch {
        return null
      }
    })
  )
  return rows.filter((r): r is VenueRow => r !== null)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function scoreColour(score: number): string {
  if (score >= 75) return '#16a34a'
  if (score >= 60) return '#c47b2b'
  return '#dc2626'
}

function formatDaysAgo(date: Date): string {
  const days = Math.floor((Date.now() - date.getTime()) / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  if (days < 14) return '1 week ago'
  return `${Math.floor(days / 7)} weeks ago`
}

function groupAvgScore(venues: VenueRow[]): number | null {
  const scored = venues.filter(v => v.score != null && v.venueType !== 'festival')
  if (!scored.length) return null
  return Math.round(scored.reduce((s, v) => s + (v.score ?? 0), 0) / scored.length)
}

function groupTotalStockValue(venues: VenueRow[]): number | null {
  const valued = venues.filter(v => v.stockValue != null && v.venueType !== 'festival')
  if (!valued.length) return null
  return valued.reduce((s, v) => s + (v.stockValue ?? 0), 0)
}

function groupTotalVariance(venues: VenueRow[]): number | null {
  const varied = venues.filter(v => v.varianceDollars != null && v.venueType !== 'festival')
  if (!varied.length) return null
  return varied.reduce((s, v) => s + (v.varianceDollars ?? 0), 0)
}

function formatVariance(venues: VenueRow[]): string {
  const total = groupTotalVariance(venues)
  if (total == null) return 'no data yet'
  return `$${Math.abs(Math.round(total)).toLocaleString()} ${total < 0 ? 'short' : 'excess'}`
}

function getItemTrend(
  current: ParetoItem,
  prevPareto: ParetoItem[],
): 'worse' | 'better' | 'stable' | 'new' {
  const prev = prevPareto.find(p => p.name.toLowerCase() === current.name.toLowerCase())
  if (!prev) return 'new'
  const currentAbs = Math.abs(current.varianceDollars)
  const prevAbs = Math.abs(prev.varianceDollars)
  if (currentAbs > prevAbs * 1.2) return 'worse'
  if (currentAbs < prevAbs * 0.8) return 'better'
  return 'stable'
}

function detectAnomaly(current: ParetoItem, prevPareto: ParetoItem[]): boolean {
  const prev = prevPareto.find(p => p.name.toLowerCase() === current.name.toLowerCase())
  if (!prev) return false
  const currentAbs = Math.abs(current.varianceDollars)
  const prevAbs = Math.abs(prev.varianceDollars)
  return currentAbs > prevAbs * 2 && currentAbs > 50
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ProjectsPage({
  user,
  activeVenueId,
  onOpenVenue,
}: {
  user: User
  activeVenueId: string | null
  onOpenVenue: (venue: VenueRow) => void
}) {
  const [venues, setVenues] = useState<VenueRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedVenueId, setExpandedVenueId] = useState<string | null>(null)
  const autoSelected = useRef(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    loadVenues(user.uid)
      .then((rows) => {
        if (cancelled) return
        setVenues(rows)
        if (!autoSelected.current && rows.length === 1) {
          autoSelected.current = true
          onOpenVenue(rows[0])
        }
      })
      .catch((e) => !cancelled && setError(e?.message || 'Could not load projects.'))
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.uid])

  const venueCount = venues.filter(v => v.venueType !== 'festival').length
  const avgScore = groupAvgScore(venues)
  const totalStock = groupTotalStockValue(venues)
  const totalVariance = groupTotalVariance(venues)

  return (
    <div>
      <h1 className={styles.heading}>My Projects</h1>
      <p className={styles.subhead}>
        {venues.length} project{venues.length !== 1 ? 's' : ''}
      </p>

      {loading && <p className={styles.loading}>Loading projects…</p>}
      {error && <p className={styles.error}>{error}</p>}

      {!loading && !error && venues.length === 0 && (
        <p className={styles.empty}>No projects yet. Create your first venue or festival from the mobile app.</p>
      )}

      {/* ── Command Centre (2+ venues) ── */}
      {!loading && !error && venues.length >= 2 && (
        <div className={styles.commandCentre}>
          <div className={styles.commandCentreHeader}>
            <h2 className={styles.commandCentreTitle}>Group Overview</h2>
            <p className={styles.commandCentreSubtitle}>
              {venueCount} venue{venueCount !== 1 ? 's' : ''} · Total variance: {formatVariance(venues)} · Updated from each venue's Performance screen
            </p>
          </div>

          <div className={styles.commandTable}>
            <div className={styles.commandTableHeader}>
              <span>Venue</span>
              <span>Hosti Health</span>
              <span>Stock Value</span>
              <span>Variance</span>
              <span>Top Variances</span>
              <span>Last Stocktake</span>
              <span></span>
            </div>

            {venues
              .filter(v => v.venueType !== 'festival')
              .sort((a, b) => (a.score ?? 999) - (b.score ?? 999))
              .map(venue => (
                <div key={venue.id}>
                  <div
                    className={`${styles.commandRow} ${expandedVenueId === venue.id ? styles.commandRowExpanded : ''}`}
                    onClick={() => setExpandedVenueId(expandedVenueId === venue.id ? null : venue.id)}
                    style={{ cursor: 'pointer' }}
                  >
                    <span className={styles.commandVenueName}>{venue.name}</span>
                    <span className={styles.commandScore}>
                      {venue.score != null ? (
                        <>
                          <span className={styles.commandScoreNum} style={{ color: scoreColour(venue.score) }}>{venue.score}</span>
                          <span className={styles.commandScoreLabel}>{venue.scoreLabel}</span>
                        </>
                      ) : (
                        <span className={styles.commandNoData}>No data yet</span>
                      )}
                    </span>
                    <span className={styles.commandValue}>
                      {venue.stockValue != null ? `$${Math.round(venue.stockValue).toLocaleString()}` : '—'}
                    </span>
                    <span className={`${styles.commandVariance} ${(venue.varianceDollars ?? 0) < -200 ? styles.commandVarianceHigh : ''}`}>
                      {venue.varianceDollars != null
                        ? `$${Math.abs(Math.round(venue.varianceDollars)).toLocaleString()} ${venue.varianceDollars < 0 ? 'short' : 'excess'}`
                        : '—'}
                    </span>
                    <span className={styles.commandTopIssues}>
                      {venue.paretoTop10.slice(0, 3).map((item, i) => (
                        <span
                          key={i}
                          className={`${styles.varianceChip} ${item.varianceDollars < 0 ? styles.varianceChipShort : styles.varianceChipExcess}`}
                        >
                          {item.name.length > 14 ? item.name.slice(0, 13) + '…' : item.name}
                          {' '}${Math.abs(Math.round(item.varianceDollars))}
                        </span>
                      ))}
                      {venue.paretoTop10.length === 0 && <span className={styles.commandNoData}>No data</span>}
                    </span>
                    <span className={styles.commandLastStocktake}>
                      {venue.lastCompletedAt
                        ? formatDaysAgo(venue.lastCompletedAt)
                        : venue.totalStocktakesCompleted === 0
                        ? 'No stocktakes yet'
                        : '—'}
                    </span>
                    <span className={styles.commandExpandIcon}>
                      {expandedVenueId === venue.id ? '▴' : '▾'}
                    </span>
                  </div>

                  {/* Expanded detail panel */}
                  {expandedVenueId === venue.id && (
                    <div className={styles.expandedPanel}>
                      <div className={styles.expandedColumns}>
                        <div className={styles.expandedColumn}>
                          <h4 className={styles.expandedColHeading}>🔴 Shortages</h4>
                          {venue.paretoTop10.filter(p => p.varianceDollars < 0).length === 0 ? (
                            <p className={styles.expandedEmpty}>No shortages this cycle ✓</p>
                          ) : (
                            venue.paretoTop10.filter(p => p.varianceDollars < 0).map((item, i) => {
                              const trend = getItemTrend(item, venue.prevParetoTop10)
                              const isAnomaly = detectAnomaly(item, venue.prevParetoTop10)
                              return (
                                <div key={i} className={styles.expandedItem}>
                                  <span className={styles.expandedItemName}>
                                    {item.name}
                                    {isAnomaly && <span className={styles.anomalyBadge}>⚠️ anomaly</span>}
                                  </span>
                                  <span className={styles.expandedItemValue} style={{ color: '#dc2626' }}>
                                    -${Math.abs(Math.round(item.varianceDollars))}
                                  </span>
                                  <span className={`${styles.trendArrow} ${styles[`trend_${trend}`]}`}>
                                    {trend === 'worse' ? '↑' : trend === 'better' ? '↓' : trend === 'new' ? '★' : '→'}
                                  </span>
                                </div>
                              )
                            })
                          )}
                        </div>
                        <div className={styles.expandedColumn}>
                          <h4 className={styles.expandedColHeading}>🟢 Excesses</h4>
                          {venue.paretoTop10.filter(p => p.varianceDollars > 0).length === 0 ? (
                            <p className={styles.expandedEmpty}>No excesses this cycle</p>
                          ) : (
                            venue.paretoTop10.filter(p => p.varianceDollars > 0).map((item, i) => {
                              const trend = getItemTrend(item, venue.prevParetoTop10)
                              return (
                                <div key={i} className={styles.expandedItem}>
                                  <span className={styles.expandedItemName}>{item.name}</span>
                                  <span className={styles.expandedItemValue} style={{ color: '#16a34a' }}>
                                    +${Math.round(item.varianceDollars)}
                                  </span>
                                  <span className={`${styles.trendArrow} ${styles[`trend_${trend}`]}`}>
                                    {trend === 'worse' ? '↑' : trend === 'better' ? '↓' : trend === 'new' ? '★' : '→'}
                                  </span>
                                </div>
                              )
                            })
                          )}
                        </div>
                      </div>
                      <div className={styles.expandedFooter}>
                        <button
                          type="button"
                          className={styles.commandOpenBtn}
                          onClick={(e) => { e.stopPropagation(); onOpenVenue(venue) }}
                        >
                          Open {venue.name} →
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}

            {/* Group totals row */}
            <div className={`${styles.commandRow} ${styles.commandTotalsRow}`}>
              <span className={styles.commandVenueName}>Group total</span>
              <span className={styles.commandScore}>
                {avgScore != null ? (
                  <>
                    <span className={styles.commandScoreNum}>{avgScore}</span>
                    <span className={styles.commandScoreLabel}>avg</span>
                  </>
                ) : <span className={styles.commandNoData}>—</span>}
              </span>
              <span className={styles.commandValue}>
                {totalStock != null ? `$${Math.round(totalStock).toLocaleString()}` : '—'}
              </span>
              <span className={styles.commandVariance}>
                {totalVariance != null ? `$${Math.abs(Math.round(totalVariance)).toLocaleString()} total` : '—'}
              </span>
              <span>—</span>
              <span>—</span>
              <span></span>
            </div>
          </div>

          <p className={styles.updatedNote}>
            Scores update each time a venue's Performance screen is opened on mobile.
          </p>
        </div>
      )}

      {/* ── Project cards ── */}
      {!loading && !error && venues.length > 0 && (
        <>
          {venues.length >= 2 && <p className={styles.sectionDivider}>Switch Venue</p>}
          <div className={styles.grid}>
            {venues.map((venue) => {
              const isActive = venue.id === activeVenueId
              return (
                <div key={venue.id} className={`${styles.card} ${isActive ? styles.cardActive : ''}`}>
                  <div className={styles.cardTop}>
                    <h2 className={styles.cardName}>{venue.name}</h2>
                    <span className={`${styles.badge} ${venue.venueType === 'festival' ? styles.badgeFestival : ''}`}>
                      {venue.venueType === 'festival' ? 'Festival' : 'Venue'}
                    </span>
                  </div>
                  {isActive ? (
                    <span className={styles.activeLabel}>Active ✓</span>
                  ) : (
                    <button type="button" className={styles.openButton} onClick={() => onOpenVenue(venue)}>
                      Open
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
