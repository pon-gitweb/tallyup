import React, { useState, useEffect, useMemo } from 'react'
import {
  collection,
  query,
  orderBy,
  limit,
  getDocs,
  startAfter,
  type QueryDocumentSnapshot,
  type DocumentData,
} from 'firebase/firestore'
import { db } from '../firebase'
import { ChartEmptyState } from '../components/ChartEmptyState'
import styles from './InvoicesPage.module.css'

// ── Types ─────────────────────────────────────────────────────────────────────

type InvoiceLine = {
  productId?: string | null
  name: string
  qty: number
  unitCost: number | null
}

type InvoiceRow = {
  id: string
  date: Date | null
  supplierName: string | null
  invoiceNumber: string | null
  source: string | null
  type: 'invoice' | 'credit_note'
  lineCount: number | null
  totalAmount: number | null
  inlineLines: InvoiceLine[] | null
}

type SortKey = 'date' | 'supplierName' | 'invoiceNumber' | 'totalAmount'
type SortConfig = { key: SortKey; dir: 'asc' | 'desc' }

// ── Constants ─────────────────────────────────────────────────────────────────

const PAGE_LIMIT = 50

const SOURCE_LABELS: Record<string, string> = {
  'desktop-csv': 'CSV',
  'desktop-pdf': 'PDF',
  'ocr-photo': 'Photo',
  'order-receive': 'Receive',
  'credit-note-manual': 'Credit',
}

const SOURCE_OPTIONS = [
  { value: '', label: 'All sources' },
  { value: 'desktop-csv', label: 'CSV' },
  { value: 'desktop-pdf', label: 'PDF' },
  { value: 'ocr-photo', label: 'Photo' },
  { value: 'order-receive', label: 'Receive' },
  { value: 'credit-note-manual', label: 'Credit notes' },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function downloadCsv(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function escCsv(v: unknown): string {
  const s = String(v ?? '')
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function fmtDateStr(d: Date | null): string {
  if (!d) return '—'
  return d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })
}

function fmtTotal(total: number | null, type: 'invoice' | 'credit_note'): string {
  if (total == null) return '—'
  const abs = Math.abs(total)
  const str = abs >= 100 ? `$${Math.round(abs).toLocaleString()}` : `$${abs.toFixed(2)}`
  return type === 'credit_note' || total < 0 ? `(${str})` : str
}

function sourceLabel(source: string | null): string {
  return source ? (SOURCE_LABELS[source] ?? source) : '—'
}

function sourceBadgeClass(source: string | null, type: 'invoice' | 'credit_note'): string {
  if (type === 'credit_note' || source === 'credit-note-manual') return styles.badgeCredit
  switch (source) {
    case 'desktop-csv':    return styles.badgeCsv
    case 'desktop-pdf':    return styles.badgePdf
    case 'ocr-photo':      return styles.badgePhoto
    case 'order-receive':  return styles.badgeReceive
    default:               return styles.badgeDefault
  }
}

function docToRow(d: QueryDocumentSnapshot<DocumentData>): InvoiceRow {
  const data = d.data() as any
  const ts = data.invoiceDateTimestamp ?? data.date ?? data.createdAt
  const date: Date | null = ts?.toDate?.() ?? null
  const rawLines = Array.isArray(data.lines) && data.lines.length > 0 ? (data.lines as any[]) : null
  return {
    id: d.id,
    date,
    supplierName: data.supplierName ?? null,
    invoiceNumber: data.invoiceNumber ?? data.invoiceNo ?? null,
    source: data.source ?? null,
    type: data.type === 'credit_note' ? 'credit_note' : 'invoice',
    lineCount: rawLines?.length ?? data.lineCount ?? null,
    totalAmount: data.totalAmount ?? null,
    inlineLines: rawLines
      ? rawLines.map((l: any): InvoiceLine => ({
          productId: l.productId ?? null,
          name: l.productName ?? l.name ?? '—',
          qty: l.qty ?? l.quantity ?? 0,
          unitCost: l.unitCost ?? l.cost ?? l.unitPrice ?? l.price ?? null,
        }))
      : null,
  }
}

// ── Detail panel ──────────────────────────────────────────────────────────────

function DetailPanel({
  row,
  lines,
}: {
  row: InvoiceRow
  lines: InvoiceLine[] | 'loading' | 'error' | undefined
}) {
  const isCredit = row.type === 'credit_note'

  return (
    <div className={styles.detail}>
      <div className={styles.detailMeta}>
        {isCredit && (
          <span className={`${styles.badge} ${styles.badgeCredit}`}>Credit Note</span>
        )}
        <span className={styles.detailMetaItem}>
          <strong>Date:</strong> {fmtDateStr(row.date)}
        </span>
        <span className={styles.detailMetaItem}>
          <strong>Supplier:</strong> {row.supplierName ?? '—'}
        </span>
        {row.invoiceNumber && (
          <span className={styles.detailMetaItem}>
            <strong>Invoice #:</strong> {row.invoiceNumber}
          </span>
        )}
        <span className={styles.detailMetaItem}>
          <strong>Source:</strong> {sourceLabel(row.source)}
        </span>
        {row.totalAmount != null && (
          <span className={styles.detailMetaItem}>
            <strong>Total:</strong>{' '}
            <span className={isCredit || row.totalAmount < 0 ? styles.negative : undefined}>
              {fmtTotal(row.totalAmount, row.type)}
            </span>
          </span>
        )}
      </div>

      {lines === undefined || lines === 'loading' ? (
        <p className={styles.detailLoading}>Loading lines…</p>
      ) : lines === 'error' ? (
        <p className={styles.detailError}>Could not load line items.</p>
      ) : lines.length === 0 ? (
        <p className={styles.detailEmpty}>No line items found.</p>
      ) : (
        <div className={styles.linesWrap}>
          <table className={styles.linesTable}>
            <thead>
              <tr>
                <th className={styles.linesth}>Product</th>
                <th className={`${styles.linesth} ${styles.right}`}>Qty</th>
                <th className={`${styles.linesth} ${styles.right}`}>Unit cost</th>
                <th className={`${styles.linesth} ${styles.right}`}>Line total</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const lineTotal =
                  l.qty != null && l.unitCost != null ? l.qty * l.unitCost : null
                const isNeg = lineTotal != null && lineTotal < 0
                return (
                  <tr key={i} className={styles.linesRow}>
                    <td className={styles.linestd}>{l.name}</td>
                    <td className={`${styles.linestd} ${styles.right}`}>{l.qty}</td>
                    <td className={`${styles.linestd} ${styles.right}`}>
                      {l.unitCost != null ? `$${Math.abs(l.unitCost).toFixed(2)}` : '—'}
                    </td>
                    <td
                      className={`${styles.linestd} ${styles.right}${isNeg ? ` ${styles.negative}` : ''}`}
                    >
                      {lineTotal != null
                        ? isNeg
                          ? `($${Math.abs(lineTotal).toFixed(2)})`
                          : `$${lineTotal.toFixed(2)}`
                        : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function InvoicesPage({
  venueId,
  onNavigate,
}: {
  venueId: string
  onNavigate: (page: string) => void
}) {
  const [rows, setRows] = useState<InvoiceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [lastDoc, setLastDoc] = useState<QueryDocumentSnapshot<DocumentData> | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

  const [supplierFilter, setSupplierFilter] = useState('')
  const [sourceFilter, setSourceFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const [sort, setSort] = useState<SortConfig>({ key: 'date', dir: 'desc' })

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [detailLines, setDetailLines] = useState<
    Record<string, InvoiceLine[] | 'loading' | 'error'>
  >({})

  useEffect(() => {
    loadPage()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venueId])

  async function loadPage(after?: QueryDocumentSnapshot<DocumentData>) {
    const isFirst = !after
    if (isFirst) {
      setLoading(true)
      setError(false)
    }
    try {
      const snap = await getDocs(
        after
          ? query(
              collection(db, 'venues', venueId, 'invoices'),
              orderBy('createdAt', 'desc'),
              startAfter(after),
              limit(PAGE_LIMIT),
            )
          : query(
              collection(db, 'venues', venueId, 'invoices'),
              orderBy('createdAt', 'desc'),
              limit(PAGE_LIMIT),
            ),
      )
      const newRows = snap.docs.map(docToRow)
      setRows(prev => (isFirst ? newRows : [...prev, ...newRows]))
      setHasMore(snap.docs.length === PAGE_LIMIT)
      setLastDoc(snap.docs[snap.docs.length - 1] ?? null)
    } catch (e) {
      console.error('[InvoicesPage]', e)
      if (isFirst) setError(true)
    } finally {
      if (isFirst) setLoading(false)
      else setLoadingMore(false)
    }
  }

  async function handleLoadMore() {
    if (!lastDoc || loadingMore) return
    setLoadingMore(true)
    await loadPage(lastDoc)
  }

  async function handleRowClick(row: InvoiceRow) {
    if (expandedId === row.id) {
      setExpandedId(null)
      return
    }
    setExpandedId(row.id)

    if (row.inlineLines) {
      setDetailLines(prev => ({ ...prev, [row.id]: row.inlineLines! }))
      return
    }

    // Cached from previous expand
    if (detailLines[row.id]) return

    setDetailLines(prev => ({ ...prev, [row.id]: 'loading' }))
    try {
      const snap = await getDocs(
        collection(db, 'venues', venueId, 'invoices', row.id, 'lines'),
      )
      const lines: InvoiceLine[] = snap.docs.map(d => {
        const l = d.data() as any
        return {
          productId: l.productId ?? null,
          name: l.productName ?? l.name ?? '—',
          qty: l.qty ?? l.quantity ?? 0,
          unitCost: l.unitCost ?? l.cost ?? l.unitPrice ?? l.price ?? null,
        }
      })
      setDetailLines(prev => ({ ...prev, [row.id]: lines }))
    } catch {
      setDetailLines(prev => ({ ...prev, [row.id]: 'error' }))
    }
  }

  const displayed = useMemo(() => {
    const dateFromMs = dateFrom ? new Date(dateFrom).getTime() : null
    const dateToMs = dateTo ? new Date(dateTo + 'T23:59:59').getTime() : null
    const sup = supplierFilter.toLowerCase().trim()

    const filtered = rows.filter(r => {
      if (sup && !(r.supplierName ?? '').toLowerCase().includes(sup)) return false
      // Credit notes are never hidden by the source filter
      if (sourceFilter && r.type !== 'credit_note' && r.source !== sourceFilter) return false
      const ms = r.date?.getTime() ?? null
      if (dateFromMs != null && ms != null && ms < dateFromMs) return false
      if (dateToMs != null && ms != null && ms > dateToMs) return false
      return true
    })

    return [...filtered].sort((a, b) => {
      const { key, dir } = sort
      let av: any = a[key]
      let bv: any = b[key]
      if (key === 'date') {
        av = (av as Date | null)?.getTime() ?? 0
        bv = (bv as Date | null)?.getTime() ?? 0
      }
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      if (typeof av === 'number' && typeof bv === 'number') {
        return dir === 'desc' ? bv - av : av - bv
      }
      return dir === 'desc'
        ? String(bv).localeCompare(String(av))
        : String(av).localeCompare(String(bv))
    })
  }, [rows, supplierFilter, sourceFilter, dateFrom, dateTo, sort])

  function toggleSort(key: SortKey) {
    setSort(prev =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'desc' },
    )
  }

  function sortMark(key: SortKey) {
    if (sort.key !== key) return ''
    return sort.dir === 'asc' ? ' ▲' : ' ▼'
  }

  function exportCsv() {
    const dateStr = new Date().toISOString().slice(0, 10)
    let csv = 'Date,Supplier,Invoice #,Type,Source,Lines,Total\n'
    for (const r of displayed) {
      csv +=
        [
          escCsv(fmtDateStr(r.date)),
          escCsv(r.supplierName ?? ''),
          escCsv(r.invoiceNumber ?? ''),
          escCsv(r.type),
          escCsv(sourceLabel(r.source)),
          r.lineCount ?? '',
          r.totalAmount != null ? r.totalAmount.toFixed(2) : '',
        ].join(',') + '\n'
    }
    downloadCsv(`invoices-${dateStr}.csv`, csv)
  }

  if (loading) return <p className={styles.loading}>Loading invoices…</p>
  if (error)
    return <p className={styles.errorText}>Could not load invoices. Please try again.</p>

  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>Invoices</h1>
      <p className={styles.subhead}>
        All invoices imported to this venue — CSV, PDF, photo, order deliveries, and credit notes.
      </p>

      <div className={styles.toolbar}>
        <div className={styles.filters}>
          <input
            type="text"
            className={styles.filterInput}
            placeholder="Supplier…"
            value={supplierFilter}
            onChange={e => setSupplierFilter(e.target.value)}
          />
          <select
            className={styles.filterSelect}
            value={sourceFilter}
            onChange={e => setSourceFilter(e.target.value)}
          >
            {SOURCE_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <input
            type="date"
            className={styles.filterDate}
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            aria-label="From date"
          />
          <span className={styles.dateSep}>–</span>
          <input
            type="date"
            className={styles.filterDate}
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            aria-label="To date"
          />
        </div>
        <button className={styles.exportBtn} onClick={exportCsv}>
          Export CSV
        </button>
      </div>

      {rows.length === 0 ? (
        <ChartEmptyState
          icon="🧾"
          title="No invoices yet"
          body="Import your first invoice using the Import page — CSV, PDF, or photo."
          action={{ label: 'Go to Import', onClick: () => onNavigate('import') }}
          height={280}
        />
      ) : (
        <>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th
                    className={styles.thSortable}
                    onClick={() => toggleSort('date')}
                  >
                    Date{sortMark('date')}
                  </th>
                  <th
                    className={styles.thSortable}
                    onClick={() => toggleSort('supplierName')}
                  >
                    Supplier{sortMark('supplierName')}
                  </th>
                  <th
                    className={styles.thSortable}
                    onClick={() => toggleSort('invoiceNumber')}
                  >
                    Invoice #{sortMark('invoiceNumber')}
                  </th>
                  <th className={styles.th}>Source</th>
                  <th className={`${styles.th} ${styles.thRight}`}>Lines</th>
                  <th
                    className={`${styles.thSortable} ${styles.thRight}`}
                    onClick={() => toggleSort('totalAmount')}
                  >
                    Total{sortMark('totalAmount')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {displayed.length === 0 && (
                  <tr>
                    <td colSpan={6} className={styles.emptyCell}>
                      No invoices match the current filters.
                    </td>
                  </tr>
                )}
                {displayed.map(row => (
                  <React.Fragment key={row.id}>
                    <tr
                      className={`${styles.dataRow}${expandedId === row.id ? ` ${styles.dataRowExpanded}` : ''}`}
                      onClick={() => handleRowClick(row)}
                    >
                      <td className={styles.td}>{fmtDateStr(row.date)}</td>
                      <td className={styles.td}>{row.supplierName ?? '—'}</td>
                      <td className={styles.td}>{row.invoiceNumber ?? '—'}</td>
                      <td className={styles.td}>
                        <span
                          className={`${styles.badge} ${sourceBadgeClass(row.source, row.type)}`}
                        >
                          {sourceLabel(row.source)}
                        </span>
                      </td>
                      <td className={styles.tdNum}>{row.lineCount ?? '—'}</td>
                      <td
                        className={`${styles.tdNum}${
                          (row.totalAmount != null && row.totalAmount < 0) ||
                          row.type === 'credit_note'
                            ? ` ${styles.negative}`
                            : ''
                        }`}
                      >
                        {fmtTotal(row.totalAmount, row.type)}
                      </td>
                    </tr>
                    {expandedId === row.id && (
                      <tr className={styles.detailRow}>
                        <td colSpan={6} className={styles.detailCell}>
                          <DetailPanel row={row} lines={detailLines[row.id]} />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {hasMore && (
            <div className={styles.loadMoreWrap}>
              <button
                className={styles.loadMoreBtn}
                onClick={handleLoadMore}
                disabled={loadingMore}
              >
                {loadingMore ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
