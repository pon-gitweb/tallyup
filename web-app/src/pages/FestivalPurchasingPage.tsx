import { useEffect, useState } from 'react'
import type { User } from 'firebase/auth'
import { collection, doc, getDocs, onSnapshot, orderBy, query } from 'firebase/firestore'
import { db } from '../firebase'
import { theme } from '../theme'
import styles from './FestivalPurchasingPage.module.css'

// ─── Types ────────────────────────────────────────────────────────────────────

type EventConfig = {
  eventName: string | null
  eventType: string | null
  pricePositioning: string | null
  dailyAttendance: number | null
  startDate: string | null
  endDate: string | null
  totalBudget: number | null
  bufferPercent: number
}

type PredictionRow = {
  productId: string
  productName: string
  supplierName: string
  category: string | null
  safeOrderQty: number
  unitCost: number | null
  estimatedCost: number | null
  confidence: 'HIGH' | 'MEDIUM' | 'LOW'
  basis: 'prior_year' | 'benchmark'
  notes: string[]
  minimumCommitment: number | null
  editedQty: number | null
}

// ─── Prediction engine ────────────────────────────────────────────────────────

const BENCHMARKS: Record<string, number> = {
  beer: 2.8, wine: 0.6, spirits: 0.4, rtd: 1.2, na: 0.8,
}

const EVENT_MODIFIERS: Record<string, Record<string, number>> = {
  music_festival: { beer: 1.2, rtd: 1.1, wine: 0.9, spirits: 1.0, na: 1.0 },
  food_wine:      { beer: 0.9, wine: 1.3, spirits: 1.0, rtd: 0.9, na: 1.1 },
  sports:         { beer: 1.1, rtd: 1.2, wine: 0.7, spirits: 0.8, na: 1.0 },
  corporate:      { beer: 0.8, wine: 1.2, spirits: 1.1, rtd: 0.8, na: 1.2 },
  community:      { beer: 0.7, wine: 0.8, spirits: 0.5, rtd: 0.8, na: 1.3 },
  default:        { beer: 1.0, wine: 1.0, spirits: 1.0, rtd: 1.0, na: 1.0 },
}

const PRICE_MODIFIERS: Record<string, number> = {
  budget: 1.15, mid: 1.0, mid_range: 1.0, premium: 0.85, mixed: 1.0,
}

function calcEventDays(start: string | null, end: string | null): number {
  if (!start || !end) return 3
  const diff = new Date(end).getTime() - new Date(start).getTime()
  return Math.max(1, Math.round(diff / 86400000) + 1)
}

function runPrediction(
  products: any[],
  event: EventConfig,
  bufferPct: number,
  priorActuals: Record<string, { consumed: number }> | null,
  growthRate: number,
): PredictionRow[] {
  const eventDays = calcEventDays(event.startDate, event.endDate)
  const attendance = event.dailyAttendance ?? 1000
  const totalPersonDays = attendance * eventDays
  const modifiers = EVENT_MODIFIERS[event.eventType ?? 'default'] ?? EVENT_MODIFIERS.default
  const priceMod = PRICE_MODIFIERS[event.pricePositioning ?? 'mid'] ?? 1.0

  return products
    .filter(p => p.name && (p.category || p.supplierName))
    .map(p => {
      const catKey = (p.category || '').toLowerCase().replace(/[^a-z]/g, '')
      const benchmark = BENCHMARKS[catKey] ?? 0
      const modifier = modifiers[catKey] ?? 1.0

      let predictedQty: number
      let basis: 'prior_year' | 'benchmark' = 'benchmark'
      const notes: string[] = []

      if (priorActuals && priorActuals[p.id]) {
        const prior = priorActuals[p.id]
        predictedQty = Math.ceil(prior.consumed * (1 + growthRate))
        basis = 'prior_year'
        notes.push(`Based on ${prior.consumed} units at prior event × ${growthRate >= 0 ? '+' : ''}${(growthRate * 100).toFixed(0)}% growth`)
      } else if (benchmark > 0) {
        predictedQty = Math.ceil(totalPersonDays * benchmark * modifier * priceMod)
        notes.push(`Benchmark ${benchmark}/person/day × ${attendance} × ${eventDays} days`)
      } else {
        return null
      }

      const bufferedQty = Math.ceil(predictedQty * (1 + bufferPct / 100))
      const confidence: 'HIGH' | 'MEDIUM' | 'LOW' = basis === 'prior_year' ? 'HIGH' : 'LOW'

      return {
        productId: p.id,
        productName: p.name,
        supplierName: p.supplierName || 'Unassigned',
        category: p.category || null,
        safeOrderQty: bufferedQty,
        unitCost: p.costPrice ?? null,
        estimatedCost: p.costPrice ? Math.round(bufferedQty * p.costPrice * 100) / 100 : null,
        confidence,
        basis,
        notes,
        minimumCommitment: null,
        editedQty: null,
      } as PredictionRow
    })
    .filter((r): r is PredictionRow => r !== null)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtMoney(v: number | null): string {
  if (v == null) return '—'
  return '$' + Math.round(v).toLocaleString('en-NZ')
}

function escCsv(v: unknown): string {
  const s = String(v ?? '')
  return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s
}

function downloadCsv(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

// ─── Setup option lists ───────────────────────────────────────────────────────

const EVENT_TYPE_OPTIONS = [
  { value: 'music_festival', label: 'Music Festival' },
  { value: 'food_wine',      label: 'Food & Wine' },
  { value: 'sports',         label: 'Sports' },
  { value: 'corporate',      label: 'Corporate' },
  { value: 'community',      label: 'Community' },
]

const PRICE_OPTIONS = [
  { value: 'budget',  label: 'Budget' },
  { value: 'mid',     label: 'Mid-range' },
  { value: 'premium', label: 'Premium' },
]

const BUFFER_OPTIONS = [5, 10, 15, 20, 25, 30]

const GROWTH_OPTIONS = [
  { label: 'First event', value: 0 },
  { label: 'Same 0%',     value: 0 },
  { label: '+5%',         value: 0.05 },
  { label: '+10%',        value: 0.10 },
  { label: '+15%',        value: 0.15 },
  { label: '−5%',         value: -0.05 },
]

// ─── Component ────────────────────────────────────────────────────────────────

export default function FestivalPurchasingPage({ venueId, user: _user }: { venueId: string; user: User }) {
  const [event, setEvent] = useState<EventConfig>({
    eventName: null, eventType: 'music_festival', pricePositioning: 'mid',
    dailyAttendance: null, startDate: null, endDate: null, totalBudget: null, bufferPercent: 15,
  })
  const [products, setProducts] = useState<any[]>([])
  const [rows, setRows] = useState<PredictionRow[]>([])
  const [priorActuals, setPriorActuals] = useState<Record<string, { consumed: number }> | null>(null)
  const [priorEventName, setPriorEventName] = useState<string | null>(null)
  const [setupEventType, setSetupEventType] = useState<string>('music_festival')
  const [setupPricing, setSetupPricing] = useState<string>('mid')
  const [bufferPct, setBufferPct] = useState(15)
  const [growthIdx, setGrowthIdx] = useState(0)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [expandedSuppliers, setExpandedSuppliers] = useState<Set<string>>(new Set())

  // Load event details
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'venues', venueId, 'event', 'details'), snap => {
      if (snap.exists()) {
        const d = snap.data() as any
        const e: EventConfig = {
          eventName: d.eventName ?? null,
          eventType: d.eventType ?? 'music_festival',
          pricePositioning: d.pricePositioning ?? 'mid',
          dailyAttendance: d.dailyAttendance ?? null,
          startDate: d.startDate ?? null,
          endDate: d.endDate ?? null,
          totalBudget: d.totalBudget ?? null,
          bufferPercent: d.bufferPercent ?? 15,
        }
        setEvent(e)
        setSetupEventType(e.eventType ?? 'music_festival')
        setSetupPricing(e.pricePositioning ?? 'mid')
        setBufferPct(e.bufferPercent)
      }
      setLoading(false)
    }, () => setLoading(false))
    return unsub
  }, [venueId])

  // Load products
  useEffect(() => {
    getDocs(collection(db, 'venues', venueId, 'products')).then(snap => {
      setProducts(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })))
    }).catch(() => {})
  }, [venueId])

  // Load prior year actuals
  useEffect(() => {
    if (!event.eventName) return
    ;(async () => {
      try {
        const snap = await getDocs(
          query(collection(db, 'venues', venueId, 'eventHistory'), orderBy('closedAt', 'desc'))
        )
        const match = snap.docs.find(d => {
          const data = d.data() as any
          return data.status === 'closed' && data.actualsPerProduct &&
            (data.eventName || '').toLowerCase().trim() === (event.eventName || '').toLowerCase().trim()
        })
        if (match) {
          const data = match.data() as any
          const actuals: Record<string, { consumed: number }> = {}
          Object.entries(data.actualsPerProduct || {}).forEach(([id, v]: [string, any]) => {
            actuals[id] = { consumed: v.consumed ?? 0 }
          })
          setPriorActuals(actuals)
          setPriorEventName(data.eventName ?? null)
        } else {
          setPriorActuals(null)
          setPriorEventName(null)
        }
      } catch { setPriorActuals(null) }
    })()
  }, [venueId, event.eventName])

  function handleGenerate() {
    setGenerating(true)
    try {
      const growthRate = GROWTH_OPTIONS[growthIdx]?.value ?? 0
      const effectiveEvent: EventConfig = { ...event, eventType: setupEventType, pricePositioning: setupPricing, bufferPercent: bufferPct }
      const result = runPrediction(products, effectiveEvent, bufferPct, priorActuals, growthRate)
      setRows(result)
      setExpandedSuppliers(new Set(result.map(r => r.supplierName)))
    } finally {
      setGenerating(false)
    }
  }

  function updateQty(productId: string, qty: number) {
    setRows(prev => prev.map(r => r.productId !== productId ? r : {
      ...r,
      editedQty: qty,
      estimatedCost: r.unitCost ? Math.round(qty * r.unitCost * 100) / 100 : null,
    }))
  }

  // Group by supplier
  const supplierGroups = Object.entries(
    rows.reduce<Record<string, PredictionRow[]>>((acc, r) => {
      const k = r.supplierName; if (!acc[k]) acc[k] = []; acc[k].push(r); return acc
    }, {})
  )
    .map(([supplierName, sRows]) => ({
      supplierName,
      rows: sRows,
      subtotal: sRows.every(r => r.estimatedCost != null)
        ? sRows.reduce((s, r) => s + (r.estimatedCost ?? 0), 0)
        : null,
    }))
    .sort((a, b) => (b.subtotal ?? 0) - (a.subtotal ?? 0))

  const totalCost = rows.reduce((s, r) => s + (r.estimatedCost ?? 0), 0)
  const overBudget = event.totalBudget != null && totalCost > event.totalBudget

  function exportSupplierCsv(supplierName: string, sRows: PredictionRow[]) {
    let csv = 'Product,Category,Qty,Unit Cost,Est. Cost,Confidence\n'
    sRows.forEach(r => {
      const qty = r.editedQty ?? r.safeOrderQty
      csv += [escCsv(r.productName), escCsv(r.category || ''), qty, r.unitCost ?? '', r.estimatedCost ?? '', r.confidence].join(',') + '\n'
    })
    downloadCsv(`po-${supplierName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.csv`, csv)
  }

  function exportAllCsv() {
    let csv = 'Supplier,Product,Category,Qty,Unit Cost,Est. Cost,Confidence,Basis\n'
    rows.forEach(r => {
      const qty = r.editedQty ?? r.safeOrderQty
      csv += [escCsv(r.supplierName), escCsv(r.productName), escCsv(r.category || ''), qty, r.unitCost ?? '', r.estimatedCost ?? '', r.confidence, r.basis].join(',') + '\n'
    })
    downloadCsv('festival-purchase-order.csv', csv)
  }

  async function handleShare() {
    const lines: string[] = [`${event.eventName ?? 'Festival'} — Purchase Order\nGenerated: ${new Date().toLocaleDateString('en-NZ')}\n`]
    supplierGroups.forEach(g => {
      lines.push(`\n${g.supplierName}`)
      g.rows.forEach(r => {
        const qty = r.editedQty ?? r.safeOrderQty
        lines.push(`  ${r.productName}: ${qty} units${r.estimatedCost != null ? ` — ${fmtMoney(r.estimatedCost)}` : ''}`)
      })
      if (g.subtotal != null) lines.push(`  Subtotal: ${fmtMoney(g.subtotal)}`)
    })
    if (totalCost > 0) lines.push(`\nTOTAL: ${fmtMoney(totalCost)}`)
    const text = lines.join('\n')
    try {
      if (navigator.share) { await navigator.share({ title: 'Purchase Order', text }) }
      else { await navigator.clipboard.writeText(text); alert('Copied to clipboard') }
    } catch {}
  }

  if (loading) return <p className={styles.loading}>Loading event details…</p>

  return (
    <div className={styles.page}>
      <div className={styles.twoCol}>
        {/* ── LEFT: Purchase order ── */}
        <div className={styles.leftCol}>
          <div className={styles.leftHeader}>
            <h1 className={styles.heading}>Purchase Order</h1>
            {rows.length > 0 && (
              <button type="button" className={styles.exportAllBtn} onClick={exportAllCsv}>Export all CSV</button>
            )}
          </div>

          {rows.length === 0 ? (
            <div className={styles.emptyState}>
              <p className={styles.emptyTitle}>No order generated yet</p>
              <p className={styles.emptyNote}>Configure the event parameters and tap Generate order to see your pre-event purchase order.</p>
            </div>
          ) : (
            <>
              {supplierGroups.map(g => (
                <div key={g.supplierName} className={styles.supplierCard}>
                  <div className={styles.supplierHeader}>
                    <div className={styles.supplierHeaderLeft}>
                      <span className={styles.supplierIcon}>🏢</span>
                      <span className={styles.supplierName}>{g.supplierName}</span>
                      {g.subtotal != null && <span className={styles.supplierSubtotal}>{fmtMoney(g.subtotal)}</span>}
                    </div>
                    <div className={styles.supplierHeaderRight}>
                      <button type="button" className={styles.supplierExportBtn} onClick={() => exportSupplierCsv(g.supplierName, g.rows)}>CSV</button>
                      <button
                        type="button"
                        className={styles.supplierToggleBtn}
                        onClick={() => setExpandedSuppliers(prev => {
                          const n = new Set(prev)
                          if (n.has(g.supplierName)) n.delete(g.supplierName); else n.add(g.supplierName)
                          return n
                        })}
                      >
                        {expandedSuppliers.has(g.supplierName) ? '▲' : '▼'}
                      </button>
                    </div>
                  </div>
                  <div className={styles.supplierDivider} />

                  {expandedSuppliers.has(g.supplierName) && (
                    <div className={styles.tableWrap}>
                      <table className={styles.table}>
                        <thead>
                          <tr>
                            <th>Product</th>
                            <th>Category</th>
                            <th>Qty</th>
                            <th>Unit Cost</th>
                            <th>Est. Cost</th>
                            <th>Confidence</th>
                          </tr>
                        </thead>
                        <tbody>
                          {g.rows.map(r => {
                            const effectiveQty = r.editedQty ?? r.safeOrderQty
                            return (
                              <tr key={r.productId} className={styles.dataRow}>
                                <td className={styles.td}>
                                  <div>{r.productName}</div>
                                  {r.notes.map((n, i) => <div key={i} className={styles.noteText}>{n}</div>)}
                                  {r.minimumCommitment != null && effectiveQty < r.minimumCommitment && (
                                    <div className={styles.commitWarn}>⚠️ Below min. commitment of {r.minimumCommitment}</div>
                                  )}
                                </td>
                                <td className={styles.td}>{r.category || '—'}</td>
                                <td className={styles.tdQty}>
                                  <input
                                    type="number"
                                    className={styles.qtyInput}
                                    value={effectiveQty}
                                    min={1}
                                    onChange={e => updateQty(r.productId, Math.max(1, parseInt(e.target.value) || 1))}
                                  />
                                </td>
                                <td className={styles.tdNum}>{r.unitCost != null ? `$${r.unitCost.toFixed(2)}` : '—'}</td>
                                <td className={styles.tdNum}>{fmtMoney(r.estimatedCost)}</td>
                                <td className={styles.td}>
                                  <span className={`${styles.confBadge} ${r.confidence === 'HIGH' ? styles.confHigh : r.confidence === 'MEDIUM' ? styles.confMed : styles.confLow}`}>
                                    {r.confidence}
                                  </span>
                                  <span className={r.basis === 'prior_year' ? styles.basisPrior : styles.basisBench}>
                                    {r.basis === 'prior_year' ? ' ✓' : ' ~'}
                                  </span>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}

              <div className={styles.totalRow}>
                <span className={styles.totalLabel}>TOTAL ORDER ESTIMATE</span>
                <span className={styles.totalValue}>{fmtMoney(totalCost > 0 ? totalCost : null)}</span>
              </div>
            </>
          )}
        </div>

        {/* ── RIGHT: Setup + Summary ── */}
        <div className={styles.rightCol}>
          <div className={styles.setupCard}>
            {/* Prior year indicator */}
            {priorActuals ? (
              <p className={styles.priorFound}>✓ {priorEventName ?? 'Prior event'} actuals found — using as base</p>
            ) : (
              <p className={styles.priorMissing}>No prior year data — using benchmarks</p>
            )}

            <p className={styles.setupLabel}>Event type</p>
            <div className={styles.chipRow}>
              {EVENT_TYPE_OPTIONS.map(o => (
                <button key={o.value} type="button"
                  className={`${styles.chip} ${setupEventType === o.value ? styles.chipActive : ''}`}
                  onClick={() => setSetupEventType(o.value)}>{o.label}</button>
              ))}
            </div>

            <p className={styles.setupLabel}>Audience pricing</p>
            <div className={styles.chipRow}>
              {PRICE_OPTIONS.map(o => (
                <button key={o.value} type="button"
                  className={`${styles.chip} ${setupPricing === o.value ? styles.chipActive : ''}`}
                  onClick={() => setSetupPricing(o.value)}>{o.label}</button>
              ))}
            </div>

            <p className={styles.setupLabel}>Safety buffer</p>
            <div className={styles.chipRow}>
              {BUFFER_OPTIONS.map(b => (
                <button key={b} type="button"
                  className={`${styles.chip} ${bufferPct === b ? styles.chipActive : ''}`}
                  onClick={() => setBufferPct(b)}>{b}%</button>
              ))}
            </div>

            <p className={styles.setupLabel}>Growth vs last year</p>
            <div className={styles.chipRow}>
              {GROWTH_OPTIONS.map((o, i) => (
                <button key={i} type="button"
                  className={`${styles.chip} ${growthIdx === i ? styles.chipActive : ''}`}
                  onClick={() => setGrowthIdx(i)}>{o.label}</button>
              ))}
            </div>

            <button type="button" className={styles.generateBtn} onClick={handleGenerate} disabled={generating}>
              {generating ? 'Generating…' : 'Generate order →'}
            </button>
          </div>

          {rows.length > 0 && (
            <div className={styles.summaryCard}>
              <p className={styles.summaryHeading}>Summary</p>
              <div className={styles.summaryRow}>
                <span>Products</span><span>{rows.length}</span>
              </div>
              <div className={styles.summaryRow}>
                <span>Suppliers</span><span>{supplierGroups.length}</span>
              </div>
              <div className={styles.summaryRow}>
                <span>Est. total</span><span>{fmtMoney(totalCost > 0 ? totalCost : null)}</span>
              </div>
              {event.totalBudget != null && (
                <div className={styles.summaryRow}>
                  <span>Budget</span>
                  <span style={{ color: overBudget ? theme.error : theme.success, fontWeight: 700 }}>
                    {overBudget ? `Over by ${fmtMoney(totalCost - event.totalBudget!)}` : 'Within budget'}
                  </span>
                </div>
              )}

              <div className={styles.actionRow}>
                <button type="button" className={styles.shareBtn} onClick={handleShare}>Share PO</button>
                <button type="button" className={styles.printBtn} onClick={() => window.print()}>Print</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
