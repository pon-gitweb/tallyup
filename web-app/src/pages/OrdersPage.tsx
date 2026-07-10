import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { BarChart, Bar, LabelList, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
} from 'firebase/firestore'
import { db } from '../firebase'
import { theme } from '../theme'
import {
  CHART_TOOLTIP_STYLE, CHART_GRID_PROPS, CHART_AXIS_TICK, CHART_ANIMATION, CHART_HEIGHT_BAR,
} from '../chartConfig'
import styles from './OrdersPage.module.css'

// ─── Types ────────────────────────────────────────────────────────────────────

type OrderStatus = 'draft' | 'pending' | 'submitted' | 'received'

type OrderLine = {
  id: string
  productName: string
  qty: number
  unitCost: number | null
  totalCost: number | null
}

type Order = {
  id: string
  supplierName: string | null
  supplierId: string | null
  status: OrderStatus
  rawStatus: string
  poNumber: string | null
  createdAt: Date | null
  submittedAt: Date | null
  receivedAt: Date | null
  notes: string | null
  source: string | null
  lineCount: number | null
  estimatedTotal: number | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeStatus(raw: string): OrderStatus {
  switch ((raw ?? '').toLowerCase()) {
    case 'draft':
      return 'draft'
    case 'submitted':
    case 'sent':
    case 'placed':
    case 'approved':
    case 'awaiting':
    case 'processing':
    case 'queued':
    case 'holding':
      return 'submitted'
    case 'received':
    case 'invoiced':
      return 'received'
    default:
      return 'pending'
  }
}

function fmtDate(d: Date | null): string {
  if (!d) return '—'
  return d.toLocaleDateString('en-NZ', { day: '2-digit', month: 'short', year: 'numeric' })
}

function fmtMoney(v: number | null | undefined): string {
  if (v == null) return '—'
  if (v === 0) return '$0'
  if (Math.abs(v) >= 100) return '$' + Math.round(v).toLocaleString('en-NZ')
  return '$' + Math.abs(v).toFixed(2)
}

function escCsv(v: unknown): string {
  const s = String(v ?? '')
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g, '""')}"`
    : s
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

function statusBadgeStyle(status: OrderStatus): React.CSSProperties {
  switch (status) {
    case 'draft':
      return { background: '#f3f4f6', color: theme.slateMid }
    case 'pending':
      return { background: '#eff6ff', color: theme.deepBlue }
    case 'submitted':
      return { background: '#fef3c7', color: '#92400e' }
    case 'received':
      return { background: '#dcfce7', color: '#166534' }
  }
}

const TABS: { key: OrderStatus; label: string; emptyNote: string }[] = [
  { key: 'draft', label: 'Drafts', emptyNote: 'Orders saved but not yet sent to suppliers.' },
  { key: 'pending', label: 'Pending', emptyNote: 'Orders awaiting review or not yet categorised.' },
  { key: 'submitted', label: 'Submitted', emptyNote: 'Orders sent to suppliers, awaiting delivery.' },
  { key: 'received', label: 'Received', emptyNote: 'Orders delivered and receipted.' },
]

// ─── Component ────────────────────────────────────────────────────────────────

export default function OrdersPage({ venueId }: { venueId: string }) {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [activeTab, setActiveTab] = useState<OrderStatus>('submitted')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [lines, setLines] = useState<Record<string, OrderLine[]>>({})
  const [linesLoading, setLinesLoading] = useState<Record<string, boolean>>({})
  const loadedIds = useRef(new Set<string>())

  useEffect(() => {
    setLoading(true)
    setError(false)
    loadedIds.current.clear()
    setLines({})
    setExpandedId(null)

    let q
    try {
      q = query(collection(db, 'venues', venueId, 'orders'), orderBy('createdAt', 'desc'))
    } catch {
      setError(true)
      setLoading(false)
      return
    }

    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows: Order[] = snap.docs.map((d) => {
          const data = d.data() as any
          const products: any[] = Array.isArray(data.products) ? data.products : []
          const computedTotal =
            data.estimatedTotal ??
            data.totalCost ??
            (products.length > 0
              ? products.reduce(
                  (s: number, p: any) => s + ((p.unitCost ?? 0) * (p.quantity ?? p.qty ?? 0)),
                  0,
                )
              : null)
          return {
            id: d.id,
            supplierName: data.supplierName ?? null,
            supplierId: data.supplierId ?? null,
            status: normalizeStatus(data.status ?? ''),
            rawStatus: data.status ?? '',
            poNumber: data.poNumber ?? data.poRef ?? null,
            createdAt: data.createdAt?.toDate?.() ?? null,
            submittedAt: data.submittedAt?.toDate?.() ?? null,
            receivedAt: data.receivedAt?.toDate?.() ?? null,
            notes: data.notes ?? null,
            source: data.source ?? null,
            lineCount: data.lineCount ?? (products.length || null),
            estimatedTotal: computedTotal,
          }
        })
        setOrders(rows)
        setLoading(false)
      },
      () => {
        setError(true)
        setLoading(false)
      },
    )
    return unsub
  }, [venueId])

  async function loadLines(orderId: string) {
    if (loadedIds.current.has(orderId)) return
    loadedIds.current.add(orderId)
    setLinesLoading((prev) => ({ ...prev, [orderId]: true }))
    try {
      // Try lines subcollection first
      const snap = await getDocs(
        collection(db, 'venues', venueId, 'orders', orderId, 'lines'),
      )
      let orderLines: OrderLine[] = snap.docs.map((d) => {
        const data = d.data() as any
        const qty = data.quantity ?? data.qty ?? 0
        const unitCost = data.unitCost ?? data.costPrice ?? null
        return {
          id: d.id,
          productName: data.productName ?? data.name ?? '—',
          qty,
          unitCost,
          totalCost: data.totalCost ?? (unitCost != null ? unitCost * qty : null),
        }
      })

      // Fallback: parse products array from order document
      if (orderLines.length === 0) {
        const orderDoc = await getDoc(doc(db, 'venues', venueId, 'orders', orderId))
        if (orderDoc.exists()) {
          const products: any[] = (orderDoc.data() as any)?.products ?? []
          orderLines = products.map((p: any, i: number) => {
            const qty = p.quantity ?? p.qty ?? 0
            const unitCost = p.unitCost ?? p.costPrice ?? null
            return {
              id: String(i),
              productName: p.productName ?? p.name ?? '—',
              qty,
              unitCost,
              totalCost: unitCost != null ? unitCost * qty : null,
            }
          })
        }
      }

      setLines((prev) => ({ ...prev, [orderId]: orderLines }))
    } catch {
      setLines((prev) => ({ ...prev, [orderId]: [] }))
    } finally {
      setLinesLoading((prev) => ({ ...prev, [orderId]: false }))
    }
  }

  function handleExpand(orderId: string) {
    if (expandedId === orderId) {
      setExpandedId(null)
    } else {
      setExpandedId(orderId)
      loadLines(orderId)
    }
  }

  function handleTabChange(tab: OrderStatus) {
    setActiveTab(tab)
    setExpandedId(null)
  }

  const tabCounts = useMemo(() => {
    const counts: Record<OrderStatus, number> = { draft: 0, pending: 0, submitted: 0, received: 0 }
    for (const o of orders) counts[o.status]++
    return counts
  }, [orders])

  const tabOrders = useMemo(
    () => orders.filter((o) => o.status === activeTab),
    [orders, activeTab],
  )

  const summaryStats = useMemo(() => {
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const thisMonthCount = orders.filter((o) => o.createdAt && o.createdAt >= monthStart).length
    const submittedValue = orders
      .filter((o) => o.status === 'submitted')
      .reduce((s, o) => s + (o.estimatedTotal ?? 0), 0)
    const receivedValue = orders
      .filter((o) => o.status === 'received')
      .reduce((s, o) => s + (o.estimatedTotal ?? 0), 0)
    return {
      thisMonthCount,
      submittedValue: submittedValue > 0 ? submittedValue : null,
      receivedValue: receivedValue > 0 ? receivedValue : null,
    }
  }, [orders])

  // ── Chart D: spend by supplier (received orders only) ─────────────────────
  const supplierSpend = useMemo(() => {
    const map: Record<string, { total: number; fullName: string }> = {}
    for (const o of orders.filter((o) => o.status === 'received' && (o.estimatedTotal ?? 0) > 0)) {
      const key = o.supplierName ?? 'Unassigned'
      if (!map[key]) map[key] = { total: 0, fullName: key }
      map[key].total += o.estimatedTotal ?? 0
    }
    return Object.entries(map)
      .map(([, v]) => ({
        supplier: v.fullName.length > 16 ? v.fullName.slice(0, 16) + '…' : v.fullName,
        fullSupplier: v.fullName,
        total: v.total,
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 8)
  }, [orders])

  const fmtAxisMoney = (v: number) => v >= 1000 ? `$${Math.round(v / 1000)}k` : `$${v}`

  function exportCsv() {
    const dateStr = new Date().toISOString().slice(0, 10)
    let csv =
      'Order ID,Supplier,PO Number,Created,Status,Product,Qty,Unit Cost,Line Total,Est. Order Total\n'
    for (const order of tabOrders) {
      const orderLines = lines[order.id] ?? []
      if (orderLines.length === 0) {
        csv +=
          [
            escCsv(order.id),
            escCsv(order.supplierName ?? ''),
            escCsv(order.poNumber ?? ''),
            escCsv(fmtDate(order.createdAt)),
            escCsv(order.rawStatus),
            '', '', '', '',
            order.estimatedTotal != null ? order.estimatedTotal.toFixed(2) : '',
          ].join(',') + '\n'
      } else {
        for (const line of orderLines) {
          csv +=
            [
              escCsv(order.id),
              escCsv(order.supplierName ?? ''),
              escCsv(order.poNumber ?? ''),
              escCsv(fmtDate(order.createdAt)),
              escCsv(order.rawStatus),
              escCsv(line.productName),
              line.qty,
              line.unitCost != null ? line.unitCost.toFixed(2) : '',
              line.totalCost != null ? line.totalCost.toFixed(2) : '',
              order.estimatedTotal != null ? order.estimatedTotal.toFixed(2) : '',
            ].join(',') + '\n'
        }
      }
    }
    downloadCsv(`orders-${activeTab}-${dateStr}.csv`, csv)
  }

  if (loading) return <p className={styles.loading}>Loading orders…</p>
  if (error) return <p className={styles.errorText}>Could not load orders. Please try again.</p>

  const activeTabMeta = TABS.find((t) => t.key === activeTab)!

  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>Orders</h1>
      <p className={styles.subhead}>
        Purchase orders across all suppliers. Orders are created on mobile.
      </p>

      {/* ── Summary stats ── */}
      <div className={styles.statsRow}>
        <div className={styles.statCard}>
          <p className={styles.statValue}>{summaryStats.thisMonthCount}</p>
          <p className={styles.statLabel}>Orders this month</p>
        </div>
        <div className={styles.statCard}>
          <p className={styles.statValue}>{fmtMoney(summaryStats.submittedValue)}</p>
          <p className={styles.statLabel}>Value submitted</p>
        </div>
        <div className={styles.statCard}>
          <p className={styles.statValue}>{fmtMoney(summaryStats.receivedValue)}</p>
          <p className={styles.statLabel}>Value received</p>
        </div>
      </div>

      {/* ── Tabs + export ── */}
      <div className={styles.tabs}>
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`${styles.tab} ${activeTab === tab.key ? styles.tabActive : ''}`}
            onClick={() => handleTabChange(tab.key)}
          >
            {tab.label}
            <span className={styles.tabCount}>{tabCounts[tab.key]}</span>
          </button>
        ))}
        <div className={styles.tabSpacer} />
        <button type="button" className={styles.exportBtn} onClick={exportCsv}>
          Export CSV
        </button>
      </div>

      {/* ── Chart D: spend by supplier (received tab only) ── */}
      {activeTab === 'received' && supplierSpend.length > 0 && (
        <div className={styles.chartCard}>
          <p className={styles.chartTitle}>Order spend by supplier</p>
          <p className={styles.chartSubtitle}>Received orders only</p>
          <ResponsiveContainer width="100%" height={CHART_HEIGHT_BAR}>
            <BarChart data={supplierSpend} layout="vertical" margin={{ top: 4, right: 48, left: 0, bottom: 0 }}>
              <CartesianGrid {...CHART_GRID_PROPS} horizontal={false} vertical={false} />
              <YAxis type="category" dataKey="supplier" width={130} tick={CHART_AXIS_TICK} axisLine={false} tickLine={false} />
              <XAxis type="number" tickFormatter={fmtAxisMoney} tick={CHART_AXIS_TICK} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={CHART_TOOLTIP_STYLE}
                formatter={((v: number) => [`$${Math.round(v).toLocaleString('en-NZ')}`, 'Total']) as any}
                labelFormatter={((_: string, payload: any[]) => payload?.[0]?.payload?.fullSupplier ?? '') as any}
                cursor={{ fill: 'rgba(11,19,43,0.03)' }} />
              <Bar dataKey="total" fill={theme.deepBlue} radius={[0, 4, 4, 0]} {...CHART_ANIMATION}>
                <LabelList dataKey="total" position="right" fontSize={11}
                  formatter={((v: number) => `$${Math.round(v).toLocaleString('en-NZ')}`) as any}
                  style={{ fill: theme.slateMid, fontFamily: theme.fontBody }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── Orders table ── */}
      {tabOrders.length === 0 ? (
        <div className={styles.emptyState}>
          <p className={styles.emptyTitle}>No {activeTabMeta.label.toLowerCase()}</p>
          <p className={styles.emptyNote}>{activeTabMeta.emptyNote}</p>
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Supplier</th>
                <th>PO Number</th>
                <th>Created</th>
                <th>Lines</th>
                <th>Est. Total</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {tabOrders.map((order) => {
                const isExpanded = expandedId === order.id
                const orderLines = isExpanded ? (lines[order.id] ?? []) : []
                const subtotal = orderLines.reduce((s, l) => s + (l.totalCost ?? 0), 0)

                return (
                  <Fragment key={order.id}>
                    <tr className={styles.dataRow}>
                      <td className={styles.td}>{order.supplierName ?? '—'}</td>
                      <td className={styles.td}>{order.poNumber ?? '—'}</td>
                      <td className={styles.td}>{fmtDate(order.createdAt)}</td>
                      <td className={styles.tdNum}>{order.lineCount ?? '—'}</td>
                      <td className={styles.tdNum}>{fmtMoney(order.estimatedTotal)}</td>
                      <td className={styles.td}>
                        <span className={styles.badge} style={statusBadgeStyle(order.status)}>
                          {order.rawStatus || order.status}
                        </span>
                      </td>
                      <td className={styles.actionCell}>
                        <button
                          type="button"
                          className={`${styles.viewBtn} ${isExpanded ? styles.viewBtnActive : ''}`}
                          onClick={() => handleExpand(order.id)}
                        >
                          {isExpanded ? 'Close' : 'View'}
                        </button>
                      </td>
                    </tr>

                    {isExpanded && (
                      <tr className={styles.expandRow}>
                        <td colSpan={7} className={styles.expandCell}>
                          {linesLoading[order.id] ? (
                            <div className={styles.spinnerWrap}>
                              <div className={styles.spinner} />
                            </div>
                          ) : orderLines.length === 0 ? (
                            <p className={styles.expandEmpty}>
                              No line items found for this order.
                            </p>
                          ) : (
                            <table className={styles.linesTable}>
                              <thead>
                                <tr>
                                  <th>Product</th>
                                  <th>Qty</th>
                                  <th>Unit cost</th>
                                  <th>Line total</th>
                                </tr>
                              </thead>
                              <tbody>
                                {orderLines.map((line) => (
                                  <tr key={line.id}>
                                    <td className={styles.lineTd}>{line.productName}</td>
                                    <td className={styles.lineTdNum}>{line.qty}</td>
                                    <td className={styles.lineTdNum}>{fmtMoney(line.unitCost)}</td>
                                    <td className={styles.lineTdNum}>{fmtMoney(line.totalCost)}</td>
                                  </tr>
                                ))}
                                <tr className={styles.subtotalRow}>
                                  <td
                                    colSpan={3}
                                    className={styles.lineTd}
                                    style={{ fontWeight: 700, color: theme.navy }}
                                  >
                                    Subtotal
                                  </td>
                                  <td
                                    className={styles.lineTdNum}
                                    style={{ fontWeight: 700, color: theme.navy }}
                                  >
                                    {subtotal > 0 ? fmtMoney(subtotal) : '—'}
                                  </td>
                                </tr>
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
