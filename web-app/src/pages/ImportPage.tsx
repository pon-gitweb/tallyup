import { useEffect, useRef, useState } from 'react'
import {
  addDoc, collection, doc, getDoc, getDocs, query, where, orderBy,
  serverTimestamp, setDoc, writeBatch, updateDoc, Timestamp,
} from 'firebase/firestore'
import { auth, db } from '../firebase'
import styles from './ImportPage.module.css'

// ─── Types ───────────────────────────────────────────────────────────────────

type ImportStatus = 'idle' | 'ready' | 'importing' | 'done' | 'error' | 'parsing'

// ─── Utilities ───────────────────────────────────────────────────────────────

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ }
        else { inQuotes = false }
      } else { field += ch }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      row.push(field); field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field); field = ''
      rows.push(row); row = []
    } else { field += ch }
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row) }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''))
}

function slugId(s: string): string {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 48)
    || ('p_' + Math.random().toString(36).slice(2, 8))
}

function findCol(header: string[], ...names: string[]): number {
  const h = header.map(x => x.trim().toLowerCase())
  for (const name of names) {
    const idx = h.indexOf(name.toLowerCase())
    if (idx !== -1) return idx
  }
  for (const name of names) {
    const idx = h.findIndex(col => col.includes(name.toLowerCase()))
    if (idx !== -1) return idx
  }
  return -1
}

function findHeaderRow(rows: string[][]): number {
  const terms = ['name', 'product', 'item', 'description', 'quantity', 'qty', 'price', 'cost', 'unit']
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const row = rows[i].map(c => c.trim().toLowerCase())
    if (terms.filter(t => row.some(c => c.includes(t))).length >= 2) return i
  }
  return 0
}

function readFile(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result || ''))
    r.onerror = rej
    r.readAsText(file)
  })
}

async function batchWrite(
  dbInstance: typeof db,
  path: string,
  docs: Array<{ id: string; data: Record<string, unknown> }>,
  merge = true
) {
  for (let i = 0; i < docs.length; i += 499) {
    const chunk = docs.slice(i, i + 499)
    const batch = writeBatch(dbInstance)
    for (const { id, data } of chunk) {
      batch.set(doc(dbInstance, path, id), data, { merge })
    }
    await batch.commit()
  }
}

// ─── Deduplication helpers ────────────────────────────────────────────────────

async function loadExistingProducts(venueId: string): Promise<Map<string, string>> {
  const snap = await getDocs(collection(db, 'venues', venueId, 'products'))
  const map = new Map<string, string>()
  snap.docs.forEach(d => {
    const name = ((d.data() as any).name || '').toLowerCase().trim()
    if (name) map.set(name, d.id)
  })
  return map
}

async function findExistingSupplier(venueId: string, name: string): Promise<string | null> {
  const snap = await getDocs(collection(db, 'venues', venueId, 'suppliers'))
  const needle = name.toLowerCase().trim()
  // Only match against active suppliers — soft-deleted ones (active: false) must
  // not be reactivated by an import that happens to reference their old name.
  const match = snap.docs
    .filter(d => (d.data() as any)?.active !== false)
    .find(d => {
      const existing = ((d.data() as any).name || '').toLowerCase().trim()
      return existing === needle || existing.includes(needle) || needle.includes(existing)
    })
  return match?.id ?? null
}

function buildInvoiceFingerprint(
  supplierName: string,
  lines: { name: string; qty: number | null; costPrice: number | null }[],
): string {
  const content = [
    supplierName.toLowerCase().trim(),
    lines.length,
    ...lines.slice(0, 10).map(l => `${l.name.toLowerCase().trim()}:${l.qty ?? 0}:${l.costPrice ?? 0}`),
  ].join('|')
  let hash = 0
  for (let i = 0; i < content.length; i++) {
    hash = ((hash << 5) - hash) + content.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash).toString(36)
}

// Parses a date string to a Firestore Timestamp. NZ-first (dd/mm/yyyy wins the
// regex); strings that fall through to the Date constructor may parse US-style
// for ambiguous formats — acceptable trade-off for the NZ market.
// Returns null on absent or unparseable input so callers can fall back to serverTimestamp().
function parseDateStringToTimestamp(s: string | null | undefined): Timestamp | null {
  if (!s) return null
  try {
    const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/)
    if (dmy) {
      const d = new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]))
      if (!isNaN(d.getTime())) return Timestamp.fromDate(d)
    }
    const d = new Date(s)
    if (!isNaN(d.getTime())) return Timestamp.fromDate(d)
  } catch {}
  return null
}

// ─── Zone B utilities ────────────────────────────────────────────────────────

/**
 * Converts an OCR-detected date string to YYYY-MM-DD for <input type="date">.
 * Reuses the existing NZ-aware parseDateStringToTimestamp parser.
 */
function toInputDate(raw: string | null | undefined): string {
  if (!raw) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
  const ts = parseDateStringToTimestamp(raw)
  if (!ts) return ''
  const d = ts.toDate()
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-')
}

/** Formats a YYYY-MM-DD string for display (e.g. "15 Jan 2025"). */
function fmtDisplayDate(s: string | null): string {
  if (!s) return '—'
  const d = new Date(s + 'T12:00:00')
  return isFinite(d.getTime()) ? d.toLocaleDateString('en-NZ', { day: '2-digit', month: 'short', year: 'numeric' }) : s
}

/**
 * djb2 hash — mirrors mobile's deduplication.ts (content-duplicate check, NOT
 * the same as the period-overlap check added below).
 */
function djb2(str: string): string {
  let h = 5381
  for (let i = 0; i < str.length; i++) h = Math.imul(h, 33) ^ str.charCodeAt(i)
  return (h >>> 0).toString(36)
}

function daysBetweenDates(a: Date, b: Date): number {
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86400000))
}

type SalesConflictReport = {
  id: string
  periodStart: string | null
  periodEnd: string | null
  source: string
  createdAt: Date | null
  lineCount: number
  totalRevenue: number | null
}

/**
 * Returns active (non-superseded) salesReports whose stored period overlaps
 * [newStart, newEnd].  Mirrors src/services/sales/checkPeriodOverlap.ts.
 *
 * Uses where('periodEnd','>=',startTs) to prune clearly non-overlapping docs,
 * then checks existingStart <= newEnd in memory (Firestore single-field index,
 * no composite needed).
 */
async function checkSalesPeriodOverlap(
  venueId: string, newStart: string, newEnd: string,
): Promise<SalesConflictReport[]> {
  const startDate = new Date(newStart + 'T00:00:00')
  const endDate   = new Date(newEnd   + 'T23:59:59')
  if (!isFinite(startDate.getTime()) || !isFinite(endDate.getTime())) return []

  const snap = await getDocs(query(
    collection(db, 'venues', venueId, 'salesReports'),
    where('periodEnd', '>=', Timestamp.fromDate(startDate)),
  ))

  function dToYMD(d: Date): string {
    return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-')
  }

  const results: SalesConflictReport[] = []
  for (const docSnap of snap.docs) {
    const data = docSnap.data() as any
    if (data.status === 'superseded') continue
    const existingStart: Date | null = data.periodStart?.toDate?.() ?? null
    if (existingStart && existingStart > endDate) continue
    const existingEnd: Date | null = data.periodEnd?.toDate?.() ?? null
    const createdAt: Date | null   = data.createdAt?.toDate?.() ?? null
    const lines: any[] = data.lines || data.report?.lines || []
    const totalRevenue = lines.reduce((sum: number, l: any) => {
      const v = Number(l.gross ?? l.net ?? 0); return sum + (isFinite(v) ? v : 0)
    }, 0)
    results.push({
      id: docSnap.id,
      periodStart: existingStart ? dToYMD(existingStart) : null,
      periodEnd:   existingEnd   ? dToYMD(existingEnd)   : null,
      source:      data.source ?? 'csv',
      createdAt,
      lineCount:   lines.length,
      totalRevenue: totalRevenue > 0 ? totalRevenue : null,
    })
  }
  return results
}

/**
 * After storing a salesReport, find every overlapping department snapshot and
 * write back day-weighted per-cycle allocations.
 *
 * Mirrors mobile's tagOverlappingCycles in src/services/sales/storeSalesReport.ts
 * exactly — same algorithm, same field names, same allocationMethod values.
 */
async function tagSalesOverlappingCycles(
  venueId: string, reportDocId: string, periodStart: Date, periodEnd: Date,
): Promise<{ zeroCycleWarning: boolean }> {
  const deptsSnap = await getDocs(collection(db, 'venues', venueId, 'departments'))
  type OC = { departmentId: string; cycleNumber: number; weight: number }
  const overlapping: OC[] = []

  for (const deptDoc of deptsSnap.docs) {
    const snapsSnap = await getDocs(query(
      collection(db, 'venues', venueId, 'departments', deptDoc.id, 'snapshots'),
      where('cycleEnd', '>=', Timestamp.fromDate(periodStart)),
      orderBy('cycleEnd', 'asc'),
    ))
    for (const snapDoc of snapsSnap.docs) {
      const data = snapDoc.data() as any
      if (!data.cycleStart?.toDate || !data.cycleEnd?.toDate) continue
      const cycleStart: Date    = data.cycleStart.toDate()
      const cycleEnd: Date      = data.cycleEnd.toDate()
      const cycleNumber: number = data.cycleNumber ?? 0
      if (!cycleNumber) continue
      // Standard interval overlap — cycleEnd >= periodStart already guaranteed by query
      if (periodEnd >= cycleStart) overlapping.push({ departmentId: deptDoc.id, cycleNumber, weight: 0 })
    }
  }

  const allocationMethod =
    overlapping.length === 1 ? 'exact_single_cycle' :
    overlapping.length > 1  ? 'day_weighted_estimate' : 'none'

  if (overlapping.length === 1) {
    overlapping[0].weight = 1
  } else if (overlapping.length > 1) {
    // Re-query for cycle boundaries to compute day-weighted fractions
    const boundaries = new Map<string, { cycleStart: Date; cycleEnd: Date }>()
    for (const deptDoc of deptsSnap.docs) {
      const snaps2 = await getDocs(query(
        collection(db, 'venues', venueId, 'departments', deptDoc.id, 'snapshots'),
        where('cycleEnd', '>=', Timestamp.fromDate(periodStart)),
        orderBy('cycleEnd', 'asc'),
      ))
      for (const s of snaps2.docs) {
        const d = s.data() as any
        if (!d.cycleStart?.toDate || !d.cycleEnd?.toDate || !d.cycleNumber) continue
        boundaries.set(`${deptDoc.id}:${d.cycleNumber}`, { cycleStart: d.cycleStart.toDate(), cycleEnd: d.cycleEnd.toDate() })
      }
    }
    const overlapDays = overlapping.map(oc => {
      const b = boundaries.get(`${oc.departmentId}:${oc.cycleNumber}`)
      if (!b) return 0
      const os = b.cycleStart > periodStart ? b.cycleStart : periodStart
      const oe = b.cycleEnd   < periodEnd   ? b.cycleEnd   : periodEnd
      return daysBetweenDates(os, oe)
    })
    const total = overlapDays.reduce((s, d) => s + d, 0)
    if (total > 0) overlapping.forEach((oc, i) => { oc.weight = overlapDays[i] / total })
    else { const eq = 1 / overlapping.length; overlapping.forEach(oc => { oc.weight = eq }) }
  }

  await updateDoc(doc(db, 'venues', venueId, 'salesReports', reportDocId), {
    overlappingCycles: overlapping, allocationMethod,
  })
  return { zeroCycleWarning: overlapping.length === 0 }
}

/**
 * Write a salesReport document that is structurally equivalent to what mobile's
 * storeSalesReport.ts produces — identical field names, identical types, identical
 * status value.  Both paths (PDF and CSV) use this single function.
 *
 * Field layout (matches mobile addDoc call exactly):
 *   source, report, periodStart (Timestamp), periodEnd (Timestamp),
 *   overlappingCycles ([]), allocationMethod ('none'), status ('active'), createdAt
 *
 * tagSalesOverlappingCycles then updates overlappingCycles and allocationMethod
 * to their final values — same two-step write as mobile.
 */
async function storeSalesReportWeb(args: {
  venueId: string
  source: 'pdf' | 'csv'
  lines: any[]
  periodStart: string  // YYYY-MM-DD
  periodEnd: string    // YYYY-MM-DD
  idsToSupersede?: string[]
}): Promise<{ id: string; zeroCycleWarning: boolean }> {
  const startDate = new Date(args.periodStart + 'T00:00:00')
  const endDate   = new Date(args.periodEnd   + 'T23:59:59')
  const startTs   = isFinite(startDate.getTime()) ? Timestamp.fromDate(startDate) : null
  const endTs     = isFinite(endDate.getTime())   ? Timestamp.fromDate(endDate)   : null

  // ── Step 1: store report (field layout identical to mobile's storeSalesReport addDoc) ──
  const ref = await addDoc(collection(db, 'venues', args.venueId, 'salesReports'), {
    source:            args.source,
    report:            { lines: args.lines, lineCount: args.lines.length, importedFrom: 'desktop' },
    periodStart:       startTs,
    periodEnd:         endTs,
    overlappingCycles: [],
    allocationMethod:  'none',
    status:            'active',
    createdAt:         serverTimestamp(),
  })

  // ── Step 2: tag overlapping cycles (non-throwing — mirrors mobile's try/catch) ──
  let zeroCycleWarning = false
  if (startTs && endTs) {
    try {
      const r = await tagSalesOverlappingCycles(args.venueId, ref.id, startDate, endDate)
      zeroCycleWarning = r.zeroCycleWarning
    } catch (e) {
      console.warn('[ImportPage] tagSalesOverlappingCycles failed (non-fatal)', e)
    }
  }

  // ── Step 3: soft-supersede replaced reports (field layout matches mobile's supersedeSalesReports) ──
  if (args.idsToSupersede?.length) {
    await Promise.all(args.idsToSupersede.map(id =>
      updateDoc(doc(db, 'venues', args.venueId, 'salesReports', id), {
        status:       'superseded',
        supersededBy: ref.id,
        supersededAt: serverTimestamp(),
      }),
    ))
  }

  return { id: ref.id, zeroCycleWarning }
}

// ─── DropZone component ───────────────────────────────────────────────────────

function DropZone({ title, description, badge, badgeColour, children, onFiles, accept }: {
  title: string
  description: string
  badge: string
  badgeColour: string
  children: React.ReactNode
  onFiles: (files: FileList) => void
  accept?: string
}) {
  const [dragActive, setDragActive] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <div className={styles.zone}>
      <div className={styles.zoneHeader}>
        <div>
          <h2 className={styles.zoneTitle}>{title}</h2>
          <p className={styles.zoneDesc}>{description}</p>
        </div>
        <span className={styles.zoneBadge} style={{ background: badgeColour }}>{badge}</span>
      </div>
      <div
        className={`${styles.dropArea} ${dragActive ? styles.dropAreaActive : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragActive(true) }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => { e.preventDefault(); setDragActive(false); onFiles(e.dataTransfer.files) }}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept ?? '.csv'}
          hidden
          onChange={(e) => e.target.files && onFiles(e.target.files)}
        />
        <p className={styles.dropAreaTitle}>Drag a CSV here, or click to browse</p>
        <p className={styles.dropAreaHint}>Accepts: {accept ?? '.csv'}</p>
      </div>
      {children}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ImportPage({ venueId }: { venueId: string }) {

  // ── Zone A — Opening Stock Baseline ────────────────────────────────────────
  type ARow = { name: string; unit: string | null; category: string | null; costPrice: number | null; parLevel: number | null; count: number }
  const [aRows, setARows] = useState<ARow[]>([])
  const [aStatus, setAStatus] = useState<ImportStatus>('idle')
  const [aError, setAError] = useState<string | null>(null)
  const [aDate, setADate] = useState('')
  const [_aExistingMap, setAExistingMap] = useState<Map<string, string>>(new Map())
  const [aUpdateCount, setAUpdateCount] = useState(0)
  const [aCreateCount, setACreateCount] = useState(0)

  async function handleFileA(files: FileList) {
    const file = files[0]
    if (!file) return
    setAError(null)
    setAStatus('idle')
    try {
      const text = await readFile(file)
      const rows = parseCsv(text)
      if (rows.length < 2) { setAError('No data rows found.'); return }
      const header = rows[0].map(h => h.trim().toLowerCase())
      const nameIdx = findCol(header, 'name')
      if (nameIdx === -1) { setAError('CSV must have a "Name" column.'); return }
      const unitIdx = findCol(header, 'unit')
      const categoryIdx = findCol(header, 'category')
      const costIdx = findCol(header, 'cost price', 'costprice', 'cost', 'price')
      const parIdx = findCol(header, 'par level', 'parlevel', 'par')
      const countIdx = findCol(header, 'count', 'qty', 'quantity', 'opening count')

      const parsed = rows.slice(1)
        .map(r => ({
          name: r[nameIdx]?.trim() || '',
          unit: unitIdx >= 0 ? r[unitIdx]?.trim() || null : null,
          category: categoryIdx >= 0 && r[categoryIdx]?.trim() ? r[categoryIdx].trim() : null,
          costPrice: costIdx >= 0 && r[costIdx]?.trim() ? Number(r[costIdx]) : null,
          parLevel: parIdx >= 0 && r[parIdx]?.trim() ? Number(r[parIdx]) : null,
          count: countIdx >= 0 && r[countIdx]?.trim() ? Math.round(Number(r[countIdx])) : 0,
        }))
        .filter(r => r.name)

      const existingMap = await loadExistingProducts(venueId)
      setAExistingMap(existingMap)
      const updateCount = parsed.filter(r => existingMap.has(r.name.toLowerCase().trim())).length
      setAUpdateCount(updateCount)
      setACreateCount(parsed.length - updateCount)
      setARows(parsed)
      setAStatus('ready')
    } catch {
      setAError('Failed to read file.')
    }
  }

  async function handleImportA() {
    setAStatus('importing')
    try {
      // Load existing products: id for dedup + detect already-consumed baselines
      const existingSnap = await getDocs(collection(db, 'venues', venueId, 'products'))
      const existingMap = new Map<string, string>()
      const baselineConsumed = new Set<string>()
      existingSnap.docs.forEach(d => {
        const data = d.data() as any
        const key = (data.name || '').toLowerCase().trim()
        if (!key) return
        existingMap.set(key, d.id)
        if (data.baselinePending === false) baselineConsumed.add(key)
      })
      await batchWrite(db, `venues/${venueId}/products`,
        aRows.map(r => {
          const key = r.name.toLowerCase().trim()
          return {
            id: existingMap.get(key) ?? slugId(r.name),
            data: {
              name: r.name,
              unit: r.unit,
              ...(r.category ? { category: r.category } : {}),
              costPrice: r.costPrice,
              parLevel: r.parLevel,
              confirmedCount: r.count,
              confirmedCountAt: serverTimestamp(),
              lastCount: r.count,
              lastCountAt: serverTimestamp(),
              supplierName: 'Unassigned',
              baselineCount: r.count,
              baselineDate: aDate || null,
              ...(!baselineConsumed.has(key) ? { baselinePending: r.count > 0 } : {}),
              updatedAt: serverTimestamp(),
            },
          }
        })
      )
      await updateDoc(doc(db, 'venues', venueId), {
        onboardingRoad: 'data',
        onboardingCompletedAt: serverTimestamp(),
        onboardingLastStocktakeDate: aDate || null,
        onboardingHasInvoices: false,
        onboardingHasSales: false,
        onboardingInvoiceLinesCount: 0,
      })
      setAStatus('done')
    } catch {
      setAError('Import failed. Please try again.')
      setAStatus('error')
    }
  }

  // ── Zone B — Sales Data ────────────────────────────────────────────────────
  type BRow = { name: string; qty: number; revenue: number | null }
  const [bRows, setBRows] = useState<BRow[]>([])
  const [bStatus, setBStatus] = useState<ImportStatus>('idle')
  const [bError, setBError] = useState<string | null>(null)
  const [bPdfStatus, setBPdfStatus] = useState<'idle'|'uploading'|'processing'|'ready'|'importing'|'done'>('idle')
  const [bPdfLines, setBPdfLines] = useState<any[]>([])
  const [bPdfError, setBPdfError] = useState<string|null>(null)
  const [bPdfPeriod, setBPdfPeriod] = useState<{start?:string|null;end?:string|null}>({})
  // ── Period picker state — shared between PDF and CSV paths ──
  const [bPeriodStart, setBPeriodStart] = useState('')  // YYYY-MM-DD; user must confirm before import
  const [bPeriodEnd,   setBPeriodEnd]   = useState('')
  const [bPeriodError, setBPeriodError] = useState<string|null>(null)
  const [bSalesWarning, setBSalesWarning] = useState<string|null>(null)
  // ── Period-overlap conflict ──
  type BConflict = {
    start: string; end: string; source: 'pdf'|'csv'
    reports: SalesConflictReport[]
  }
  const [bConflict, setBConflict] = useState<BConflict|null>(null)
  const [bConflictKeepBothConfirm, setBConflictKeepBothConfirm] = useState(false)

  /**
   * Called when the user clicks "Confirm period & import" on either the PDF or CSV path.
   * Validates the period, runs the content-dedup check (CSV only), checks for period
   * overlap with existing active reports, and either proceeds to write or shows the
   * conflict screen.
   */
  async function handleSalesPeriodConfirm(source: 'pdf' | 'csv') {
    // Period validation
    if (!bPeriodStart || !bPeriodEnd) {
      setBPeriodError('Please select both a start date and an end date.')
      return
    }
    if (bPeriodEnd < bPeriodStart) {
      setBPeriodError('End date must be on or after the start date.')
      return
    }
    setBPeriodError(null)
    setBSalesWarning(null)

    // CSV: content-dedup check first (prevents re-uploading the identical file;
    // this is a different concern from the period-overlap check below — keep both)
    if (source === 'csv') {
      setBStatus('importing')
      const hashKey = djb2([
        String(bRows.length),
        bRows.slice(0, 5).map((l: any) => (l.name || '').toLowerCase().trim()).join('|'),
      ].join('::'))
      const dedupSnap = await getDoc(doc(db, 'venues', venueId, 'processedSalesReports', hashKey))
      if (dedupSnap.exists()) {
        const existing = dedupSnap.data() as any
        const dateStr = existing.processedAt?.toDate?.()?.toLocaleDateString('en-NZ') || 'previously'
        setBError(`This sales report was already imported on ${dateStr}.`)
        setBStatus('error')
        return
      }
      setBStatus('ready') // reset while we do the overlap check
    }

    // Period-overlap check
    if (source === 'pdf') setBPdfStatus('importing')
    else setBStatus('importing')

    let overlapping: SalesConflictReport[]
    try {
      overlapping = await checkSalesPeriodOverlap(venueId, bPeriodStart, bPeriodEnd)
    } catch (e: any) {
      setBPeriodError('Could not check for existing reports: ' + String(e?.message || e))
      if (source === 'pdf') setBPdfStatus('ready')
      else setBStatus('ready')
      return
    }

    if (overlapping.length > 0) {
      // Show conflict screen — nothing written yet
      setBConflict({ start: bPeriodStart, end: bPeriodEnd, source, reports: overlapping })
      setBConflictKeepBothConfirm(false)
      if (source === 'pdf') setBPdfStatus('ready')
      else setBStatus('ready')
      return
    }

    // No conflicts — proceed with write
    await doSalesWrite({ source, start: bPeriodStart, end: bPeriodEnd, idsToSupersede: [] })
  }

  /**
   * Performs the actual Firestore write.  Called directly when there are no
   * conflicts, and called from the conflict screen for Replace or Keep Both.
   */
  async function doSalesWrite(args: { source: 'pdf'|'csv'; start: string; end: string; idsToSupersede: string[] }) {
    const { source, start, end, idsToSupersede } = args
    if (source === 'pdf') setBPdfStatus('importing')
    else setBStatus('importing')

    try {
      // Normalize CSV rows to match the qtySold/gross field names hostiHealth expects
      // (mobile's processSalesCsv already produces these; web CSV used qty/revenue)
      const lines = source === 'pdf'
        ? bPdfLines
        : bRows.map(r => ({ name: r.name, qtySold: r.qty, gross: r.revenue }))

      const { id, zeroCycleWarning } = await storeSalesReportWeb({
        venueId, source, lines, periodStart: start, periodEnd: end, idsToSupersede,
      })

      // CSV: write content-dedup fingerprint after successful save
      if (source === 'csv') {
        const hashKey = djb2([
          String(bRows.length),
          bRows.slice(0, 5).map((l: any) => (l.name || '').toLowerCase().trim()).join('|'),
        ].join('::'))
        await setDoc(doc(db, 'venues', venueId, 'processedSalesReports', hashKey), {
          lineCount: bRows.length, reportId: id, processedAt: serverTimestamp(),
        })
        // Non-blocking: trigger product matching
        auth.currentUser?.getIdToken().then(token =>
          fetch('https://us-central1-tallyup-f1463.cloudfunctions.net/api/match-sales-report', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ venueId, reportId: id }),
          })
        ).catch((e: any) => console.warn('[ImportPage] match-sales-report failed:', e?.message))
      }

      await updateDoc(doc(db, 'venues', venueId), { onboardingHasSales: true })

      if (zeroCycleWarning) {
        setBSalesWarning(
          `Note: this report (${start} – ${end}) doesn't overlap any completed stocktake cycle yet — it's saved, but won't factor into comparisons until a cycle covers this period.`
        )
      }

      setBConflict(null)
      setBConflictKeepBothConfirm(false)
      if (source === 'pdf') setBPdfStatus('done')
      else setBStatus('done')
    } catch (e: any) {
      console.error('[ImportPage] doSalesWrite failed', e?.message, e?.code, e)
      if (source === 'pdf') { setBPdfError(e?.message || 'Import failed. Please try again.'); setBPdfStatus('idle') }
      else { setBError(e?.message || 'Import failed. Please try again.'); setBStatus('error') }
    }
  }

  async function handleFileB(files: FileList) {
    const file = files[0]
    if (!file) return

    if (file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf') {
      setBPdfError(null)
      setBPdfLines([])
      setBPdfStatus('uploading')
      try {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result as string)
          reader.onerror = () => reject(new Error('Failed to read PDF'))
          reader.readAsDataURL(file)
        })
        const token = await auth.currentUser?.getIdToken().catch(() => null)
        if (!token) throw new Error('Not authenticated')
        const API = 'https://us-central1-tallyup-f1463.cloudfunctions.net/api'
        const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
        const destPath = `venues/${venueId}/sales/pdf/${Date.now()}-${file.name.replace(/[^\w.\-]+/g, '_').slice(0, 60)}`
        const uploadRes = await fetch(`${API}/upload-file`, {
          method: 'POST', headers,
          body: JSON.stringify({ venueId, destPath, dataUrl: base64 }),
        })
        if (!uploadRes.ok) throw new Error(`Upload failed (${uploadRes.status})`)
        const { fullPath } = await uploadRes.json()
        setBPdfStatus('processing')
        const ocrRes = await fetch(`${API}/process-sales-pdf`, {
          method: 'POST', headers,
          body: JSON.stringify({ venueId, storagePath: fullPath }),
        })
        const ocrData = await ocrRes.json().catch(() => null)
        if (!ocrRes.ok || !ocrData?.ok) throw new Error(ocrData?.error || 'Processing failed')
        if (ocrData.warnings?.length && !ocrData.lines?.length) {
          setBPdfError(ocrData.warnings[0]); setBPdfStatus('idle'); return
        }
        setBPdfLines(ocrData.lines || [])
        setBPdfPeriod(ocrData.period || {})
        // Pre-fill the period picker from OCR detection — user must still confirm before import
        setBPeriodStart(toInputDate(ocrData.period?.start))
        setBPeriodEnd(toInputDate(ocrData.period?.end))
        setBPeriodError(null)
        setBSalesWarning(null)
        setBConflict(null)
        setBPdfStatus('ready')
      } catch (e: any) {
        setBPdfError(e?.message || 'PDF processing failed. Try a CSV export from your POS instead.')
        setBPdfStatus('idle')
      }
      return
    }

    setBError(null)
    setBStatus('idle')
    try {
      const text = await readFile(file)
      const rows = parseCsv(text)
      if (rows.length < 2) { setBError('No data rows found.'); return }
      const header = rows[0].map(h => h.trim().toLowerCase())
      const nameIdx = findCol(header, 'item', 'product', 'name')
      if (nameIdx === -1) { setBError('CSV must have a Name, Item, or Product column.'); return }
      const qtyIdx = findCol(header, 'quantity', 'qty', 'units sold')
      const revIdx = findCol(header, 'revenue', 'sales', 'amount')

      const parsed = rows.slice(1)
        .map(r => ({
          name: r[nameIdx]?.trim() || '',
          qty: qtyIdx >= 0 && r[qtyIdx]?.trim() ? Number(r[qtyIdx]) : 0,
          revenue: revIdx >= 0 && r[revIdx]?.trim() ? Number(r[revIdx]) : null,
        }))
        .filter(r => r.name)

      setBRows(parsed)
      // Reset period picker — CSV has no auto-detected dates; user must fill in
      setBPeriodStart('')
      setBPeriodEnd('')
      setBPeriodError(null)
      setBSalesWarning(null)
      setBConflict(null)
      setBStatus('ready')
    } catch {
      setBError('Failed to read file.')
    }
  }

  // handleImportB removed — CSV imports now go through handleSalesPeriodConfirm('csv')

  function downloadSalesTemplate() {
    const csv = 'Name,Quantity,Revenue\n'
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'sales-template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  // ── Zone C — Supplier Invoice ──────────────────────────────────────────────
  type CRow = { name: string; qty: number | null; costPrice: number | null; supplierCol: string | null }
  const [cRows, setCRows] = useState<CRow[]>([])
  const [cStatus, setCStatus] = useState<ImportStatus>('idle')
  const [cError, setCError] = useState<string | null>(null)
  const [cSupplierName, setCSupplierName] = useState('')
  const [cExistingSupplierId, setCExistingSupplierId] = useState<string | null>(null)
  const [cSupplierFound, setCSupplierFound] = useState(false)
  const [cIsDuplicate, setCIsDuplicate] = useState(false)
  const [cDuplicateDate, setCDuplicateDate] = useState<string | null>(null)
  const [cIgnoreDuplicate, setCIgnoreDuplicate] = useState(false)
  const [cFingerprint, setCFingerprint] = useState('')
  const [cPdfError, setCPdfError] = useState<string | null>(null)
  const [cPdfLines, setCPdfLines] = useState<{ name: string; qty: number; unitPrice?: number }[]>([])
  const [cPdfSupplier, setCPdfSupplier] = useState('')
  const [cPdfStatus, setCPdfStatus] = useState<'idle' | 'uploading' | 'processing' | 'ready' | 'importing' | 'done'>('idle')
  const [cPdfInvoiceMeta, setCPdfInvoiceMeta] = useState<{
    invoiceNumber?: string | null; poNumber?: string | null; invoiceDate?: string | null
  }>({})

  async function handleFileC(files: FileList) {
    const file = files[0]
    if (!file) return

    if (file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf') {
      setCPdfError(null)
      setCPdfLines([])
      setCPdfStatus('uploading')
      try {
        // Step 1: read PDF as base64 data URL
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result as string)
          reader.onerror = () => reject(new Error('Failed to read PDF'))
          reader.readAsDataURL(file)
        })

        // Step 2: get auth token
        const token = await auth.currentUser?.getIdToken().catch(() => null)
        if (!token) throw new Error('Not authenticated. Please sign in again.')

        const API = 'https://us-central1-tallyup-f1463.cloudfunctions.net/api'
        const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }

        // Step 3: upload to Firebase Storage via Cloud Function
        const destPath = `venues/${venueId}/invoices/desktop/${Date.now()}-${file.name.replace(/[^\w.\-]+/g, '_').slice(0, 60)}`
        const uploadRes = await fetch(`${API}/upload-file`, {
          method: 'POST', headers,
          body: JSON.stringify({ venueId, destPath, dataUrl: base64 }),
        })
        if (!uploadRes.ok) {
          const err = await uploadRes.json().catch(() => ({})) as any
          throw new Error(err.error || `Upload failed (${uploadRes.status})`)
        }
        const { fullPath } = await uploadRes.json() as { fullPath: string }

        // Step 4: call OCR endpoint
        setCPdfStatus('processing')
        const ocrRes = await fetch(`${API}/process-invoices-pdf`, {
          method: 'POST', headers,
          body: JSON.stringify({ venueId, orderId: 'UNSET', storagePath: fullPath }),
        })
        const ocrData = await ocrRes.json().catch(() => null)
        if (!ocrRes.ok || !ocrData) throw new Error(ocrData?.error || ocrData?.message || `OCR failed (${ocrRes.status})`)

        // Step 5: handle scanned PDF
        if (ocrData.scannedPdf || (ocrData.message || '').toLowerCase().includes('scan')) {
          setCPdfError('This PDF appears to be a scanned image. For best results, ask your supplier for a digital PDF or CSV export, or use the mobile app to photograph the invoice.')
          setCPdfStatus('idle')
          return
        }

        // Step 6: store results for preview
        const lines = (ocrData.lines || []).filter((l: any) => l.name && l.qty > 0)
        if (!lines.length) {
          setCPdfError('No product lines could be extracted from this PDF. Try a CSV export from your supplier instead.')
          setCPdfStatus('idle')
          return
        }

        setCPdfLines(lines)
        setCPdfSupplier(ocrData.invoice?.supplierName || '')
        setCPdfInvoiceMeta({
          invoiceNumber: ocrData.invoice?.invoiceNumber ?? null,
          poNumber: ocrData.invoice?.poNumber ?? null,
          invoiceDate: ocrData.invoice?.date ?? ocrData.invoice?.invoiceDate ?? null,
        })
        setCPdfStatus('ready')
      } catch (e: any) {
        setCPdfError(e?.message || 'PDF processing failed. Please try a CSV instead.')
        setCPdfStatus('idle')
      }
      return
    }

    // CSV path
    setCError(null)
    setCStatus('idle')
    try {
      const text = await readFile(file)
      const rows = parseCsv(text)
      if (rows.length < 2) { setCError('No data rows found.'); return }
      const headerRowIdx = findHeaderRow(rows)
      const header = rows[headerRowIdx].map(h => h.trim().toLowerCase())
      const nameIdx = findCol(header, 'product', 'name', 'item')
      if (nameIdx === -1) { setCError('CSV must have a Name, Product, or Item column.'); return }
      const qtyIdx = findCol(header, 'quantity', 'qty')
      const priceIdx = findCol(header, 'unit price', 'cost', 'price')
      const supplierIdx = findCol(header, 'supplier')

      const parsed = rows.slice(headerRowIdx + 1)
        .map(r => ({
          name: r[nameIdx]?.trim() || '',
          qty: qtyIdx >= 0 && r[qtyIdx]?.trim() ? Number(r[qtyIdx]) : null,
          costPrice: priceIdx >= 0 && r[priceIdx]?.trim() ? Number(r[priceIdx]) : null,
          supplierCol: supplierIdx >= 0 ? r[supplierIdx]?.trim() || null : null,
        }))
        .filter(r => r.name)

      // Pre-fill supplier name from CSV if found
      const supplierFromCsv = supplierIdx >= 0 ? parsed[0]?.supplierCol || '' : ''
      if (supplierFromCsv) setCSupplierName(supplierFromCsv)
      const effectiveSupplier = supplierFromCsv || cSupplierName

      // Supplier deduplication
      if (effectiveSupplier) {
        const existingId = await findExistingSupplier(venueId, effectiveSupplier)
        setCExistingSupplierId(existingId)
        setCSupplierFound(!!existingId)
      }

      // Invoice fingerprint deduplication
      const fp = buildInvoiceFingerprint(effectiveSupplier, parsed)
      setCFingerprint(fp)
      setCIgnoreDuplicate(false)
      try {
        const fpSnap = await getDoc(doc(db, 'venues', venueId, 'processedInvoices', fp))
        if (fpSnap.exists()) {
          setCIsDuplicate(true)
          const importedAt = (fpSnap.data() as any)?.importedAt?.toDate?.()
          setCDuplicateDate(importedAt ? importedAt.toLocaleDateString('en-NZ') : null)
        } else {
          setCIsDuplicate(false)
          setCDuplicateDate(null)
        }
      } catch { setCIsDuplicate(false) }

      setCRows(parsed)
      setCStatus('ready')
    } catch {
      setCError('Failed to read file.')
    }
  }

  async function handleImportC() {
    setCStatus('importing')
    try {
      // Find or create supplier
      let supplierId = cExistingSupplierId
      if (!supplierId && cSupplierName.trim()) {
        const ref = await addDoc(collection(db, 'venues', venueId, 'suppliers'), {
          name: cSupplierName.trim(),
          orderingMethod: 'email',
          createdAt: serverTimestamp(),
        })
        supplierId = ref.id
      }

      // Load existing products for name-based matching
      const existingMap = await loadExistingProducts(venueId)

      await batchWrite(db, `venues/${venueId}/products`,
        cRows.map(r => ({
          id: existingMap.get(r.name.toLowerCase().trim()) ?? slugId(r.name),
          data: {
            name: r.name,
            costPrice: r.costPrice,
            supplierName: cSupplierName.trim() || 'Unassigned',
            ...(supplierId ? { supplierId } : {}),
            updatedAt: serverTimestamp(),
          },
        }))
      )
      await updateDoc(doc(db, 'venues', venueId), {
        onboardingHasInvoices: true,
        onboardingInvoiceLinesCount: cRows.length,
      })

      // Write fingerprint to prevent duplicate re-import
      if (cFingerprint) {
        await setDoc(doc(db, 'venues', venueId, 'processedInvoices', cFingerprint), {
          importedAt: serverTimestamp(),
          supplierName: cSupplierName.trim(),
          lineCount: cRows.length,
          source: 'desktop-csv',
        })
      }

      // Persist invoice record — inline shape matches ocrInvoicePhoto.ts
      // When cIsDuplicate && cIgnoreDuplicate the user explicitly overrode the
      // dedup warning; this path now creates a second invoice doc (not just
      // re-runs prices). That's intentional — they said "import anyway."
      const csvLines = cRows.map(r => ({
        name: r.name, productName: r.name,
        qty: r.qty ?? 0,
        unitCost: r.costPrice ?? null, cost: r.costPrice ?? null, unitPrice: r.costPrice ?? null,
        lineTotal: r.qty != null && r.costPrice != null ? r.qty * r.costPrice : null,
      }))
      await addDoc(collection(db, 'venues', venueId, 'invoices'), {
        supplierId: supplierId ?? null,
        supplierName: cSupplierName.trim() || 'Unassigned',
        invoiceNumber: null,
        poNumber: null,
        invoiceDate: null,
        invoiceDateTimestamp: null,
        date: serverTimestamp(),
        totalAmount: csvLines.reduce((s, l) => s + l.qty * (l.unitCost ?? 0), 0),
        gstAmount: null,
        lines: csvLines,
        lineCount: csvLines.length,
        venueId,
        source: 'desktop-csv',
        createdAt: serverTimestamp(),
        processedAt: serverTimestamp(),
      })

      setCStatus('done')
    } catch {
      setCError('Import failed. Please try again.')
      setCStatus('error')
    }
  }

  async function handleImportPdf() {
    if (!cPdfLines.length) return
    setCPdfStatus('importing')
    try {
      const supplierName = cPdfSupplier.trim() || 'Unassigned'

      // Dedup — same fingerprint gate as CSV path; checked here (not in UI) so a
      // duplicate hit can't create a phantom supplier before we bail out
      const pdfFp = buildInvoiceFingerprint(
        supplierName,
        cPdfLines.map(l => ({ name: l.name, qty: l.qty, costPrice: l.unitPrice ?? null }))
      )
      const pdfFpRef = doc(db, 'venues', venueId, 'processedInvoices', pdfFp)
      const pdfFpSnap = await getDoc(pdfFpRef)
      if (pdfFpSnap.exists()) {
        const imported = (pdfFpSnap.data() as any).importedAt?.toDate?.()
        setCPdfError(`This invoice was already imported${imported ? ` on ${imported.toLocaleDateString('en-NZ')}` : ''}.`)
        setCPdfStatus('idle')
        return
      }

      const existingMap = await loadExistingProducts(venueId)

      // Find or create supplier
      let supplierId: string | null = null
      if (supplierName !== 'Unassigned') {
        const suppliersSnap = await getDocs(collection(db, 'venues', venueId, 'suppliers'))
        // Exclude soft-deleted suppliers when matching — absent field means active.
        const existing = suppliersSnap.docs
          .filter(d => (d.data() as any)?.active !== false)
          .find(d =>
            ((d.data() as any).name || '').toLowerCase().trim() === supplierName.toLowerCase()
          )
        if (existing) {
          supplierId = existing.id
        } else {
          const newRef = await addDoc(collection(db, 'venues', venueId, 'suppliers'), {
            name: supplierName, orderingMethod: 'email', createdAt: serverTimestamp(),
          })
          supplierId = newRef.id
        }
      }

      await batchWrite(db, `venues/${venueId}/products`,
        cPdfLines.map((l: any) => ({
          id: existingMap.get((l.name || '').toLowerCase().trim()) ?? slugId(l.name),
          data: {
            name: l.name,
            costPrice: l.unitPrice ?? null,
            supplierName,
            ...(supplierId ? { supplierId } : {}),
            updatedAt: serverTimestamp(),
          },
        }))
      )

      await updateDoc(doc(db, 'venues', venueId), {
        onboardingHasInvoices: true,
        onboardingInvoiceLinesCount: cPdfLines.length,
      })

      const parsedInvoiceTs = parseDateStringToTimestamp(cPdfInvoiceMeta.invoiceDate ?? null)

      // Persist invoice record — inline shape matches ocrInvoicePhoto.ts
      const pdfLines = cPdfLines.map(l => ({
        name: l.name, productName: l.name,
        qty: l.qty,
        unitCost: l.unitPrice ?? null, cost: l.unitPrice ?? null, unitPrice: l.unitPrice ?? null,
        lineTotal: l.unitPrice != null ? l.qty * l.unitPrice : null,
      }))
      await addDoc(collection(db, 'venues', venueId, 'invoices'), {
        supplierId: supplierId ?? null,
        supplierName,
        invoiceNumber: cPdfInvoiceMeta.invoiceNumber ?? null,
        poNumber: cPdfInvoiceMeta.poNumber ?? null,
        invoiceDate: cPdfInvoiceMeta.invoiceDate ?? null,
        invoiceDateTimestamp: parsedInvoiceTs,
        date: parsedInvoiceTs ?? serverTimestamp(),
        totalAmount: pdfLines.reduce((s, l) => s + l.qty * (l.unitCost ?? 0), 0),
        gstAmount: null,
        lines: pdfLines,
        lineCount: pdfLines.length,
        venueId,
        source: 'desktop-pdf',
        createdAt: serverTimestamp(),
        processedAt: serverTimestamp(),
      })
      await setDoc(pdfFpRef, {
        importedAt: serverTimestamp(), supplierName, lineCount: cPdfLines.length, source: 'desktop-pdf',
      })

      setCPdfStatus('done')
    } catch {
      setCPdfError('Import failed. Please try again.')
      setCPdfStatus('idle')
    }
  }

  // ── Zone D — Supplier Catalogue ────────────────────────────────────────────
  type DRow = { name: string; price: number; currentCost: number | null; isNew: boolean }
  const [dRows, setDRows] = useState<DRow[]>([])
  const [dStatus, setDStatus] = useState<ImportStatus>('idle')
  const [dError, setDError] = useState<string | null>(null)
  const [dSupplierName, setDSupplierName] = useState('')
  const [existingPrices, setExistingPrices] = useState<Record<string, number | null>>({})
  const [dAllSuppliers, setDAllSuppliers] = useState<Map<string, string>>(new Map())

  useEffect(() => {
    if (!venueId) return
    getDocs(collection(db, 'venues', venueId, 'products')).then(snap => {
      const map: Record<string, number | null> = {}
      snap.docs.forEach(d => {
        const data = d.data() as { name?: string; costPrice?: number }
        if (data.name) map[data.name.toLowerCase()] = data.costPrice ?? null
      })
      setExistingPrices(map)
    }).catch(() => {})
    getDocs(collection(db, 'venues', venueId, 'suppliers')).then(snap => {
      const map = new Map<string, string>()
      snap.docs
        .filter(d => (d.data() as any)?.active !== false) // exclude soft-deleted
        .forEach(d => {
          const name = ((d.data() as any).name || '').toLowerCase().trim()
          if (name) map.set(name, d.id)
        })
      setDAllSuppliers(map)
    }).catch(() => {})
  }, [venueId])

  // Derive supplier match reactively from current input
  const dSupplierMatch = dSupplierName.trim()
    ? dAllSuppliers.get(dSupplierName.toLowerCase().trim()) ?? null
    : null

  async function handleFileD(files: FileList) {
    const file = files[0]
    if (!file) return
    setDError(null)
    setDStatus('idle')
    try {
      const text = await readFile(file)
      const rows = parseCsv(text)
      if (rows.length < 2) { setDError('No data rows found.'); return }
      const header = rows[0].map(h => h.trim().toLowerCase())
      const nameIdx = findCol(header, 'product', 'name', 'item')
      if (nameIdx === -1) { setDError('CSV must have a Name, Product, or Item column.'); return }
      const priceIdx = findCol(header, 'price', 'cost', 'unit price')
      if (priceIdx === -1) { setDError('CSV must have a Price, Cost, or Unit Price column.'); return }

      const parsed = rows.slice(1)
        .map(r => {
          const name = r[nameIdx]?.trim() || ''
          const price = r[priceIdx]?.trim() ? Number(r[priceIdx]) : 0
          const currentCost = existingPrices[name.toLowerCase()] ?? null
          return { name, price, currentCost, isNew: currentCost === null }
        })
        .filter(r => r.name)

      setDRows(parsed)
      setDStatus('ready')
    } catch {
      setDError('Failed to read file.')
    }
  }

  async function handleImportD() {
    setDStatus('importing')
    try {
      // Find or create supplier
      let supplierId = dSupplierMatch
      if (!supplierId && dSupplierName.trim()) {
        const ref = await addDoc(collection(db, 'venues', venueId, 'suppliers'), {
          name: dSupplierName.trim(),
          orderingMethod: 'email',
          createdAt: serverTimestamp(),
        })
        supplierId = ref.id
      }

      // Load existing products for name-based matching
      const existingMap = await loadExistingProducts(venueId)

      const priceChanges = dRows.filter(r => !r.isNew && r.currentCost !== r.price)
      await batchWrite(db, `venues/${venueId}/products`,
        dRows.map(r => ({
          id: existingMap.get(r.name.toLowerCase().trim()) ?? slugId(r.name),
          data: {
            name: r.name,
            costPrice: r.price,
            supplierName: dSupplierName.trim() || 'Unassigned',
            ...(supplierId ? { supplierId } : {}),
            updatedAt: serverTimestamp(),
          },
        }))
      )
      if (priceChanges.length > 0) {
        const batch = writeBatch(db)
        for (const r of priceChanges) {
          batch.set(doc(collection(db, 'venues', venueId, 'priceChangeFlags')), {
            productName: r.name,
            supplierName: dSupplierName,
            oldPrice: r.currentCost,
            newPrice: r.price,
            detectedAt: serverTimestamp(),
            status: 'pending',
            source: 'catalogue-import',
          })
        }
        await batch.commit()
      }
      setDStatus('done')
    } catch {
      setDError('Import failed. Please try again.')
      setDStatus('error')
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>Import</h1>
      <p className={styles.subhead}>
        Drag files from your computer to import data into Hosti. Each section is independent — import one or all.
      </p>

      {/* ── Zone A — Opening Stock Baseline ── */}
      <DropZone
        title="Opening Stock Baseline"
        description="Import a list of products with their opening stock counts. This becomes the baseline for your first stocktake variance report."
        badge="Step 1"
        badgeColour="#1b4f72"
        onFiles={handleFileA}
      >
        {aError && <p className={styles.error}>{aError}</p>}
        {(aStatus === 'ready' || aStatus === 'importing') && (
          <div className={styles.preview}>
            <p className={styles.previewTitle}>{aRows.length} products found</p>
            <p className={styles.deduplicateSummary}>
              {aUpdateCount > 0 || aCreateCount > 0
                ? `${aUpdateCount} will update existing · ${aCreateCount} will be created new`
                : null}
            </p>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr><th>Name</th><th>Unit</th><th>Cost</th><th>Count</th></tr>
                </thead>
                <tbody>
                  {aRows.slice(0, 20).map((r, i) => (
                    <tr key={i}>
                      <td>{r.name}</td>
                      <td>{r.unit || '—'}</td>
                      <td>{r.costPrice != null ? `$${r.costPrice}` : '—'}</td>
                      <td>{r.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {aRows.length > 20 && (
              <p className={styles.dropAreaHint} style={{ marginTop: 6 }}>
                Showing first 20 of {aRows.length}
              </p>
            )}
            <div className={styles.dateInput}>
              <label>Date of this stocktake (optional):</label>
              <input type="date" value={aDate} onChange={e => setADate(e.target.value)} />
            </div>
            <div className={styles.actions}>
              <button
                className={styles.cancelBtn}
                onClick={() => { setARows([]); setAStatus('idle'); setAError(null) }}
              >
                Cancel
              </button>
              <button
                className={styles.confirmBtn}
                onClick={handleImportA}
                disabled={aStatus === 'importing'}
              >
                {aStatus === 'importing' ? 'Importing…' : `Import ${aRows.length} products`}
              </button>
            </div>
          </div>
        )}
        {aStatus === 'done' && (
          <p className={styles.success}>
            ✓ {aRows.length} products imported with opening counts. Your first real stocktake will show variance against this baseline.
          </p>
        )}
      </DropZone>

      {/* ── Zone B — Sales Data ── */}
      <DropZone
        title="Sales Data"
        description="Import a POS sales report — CSV or PDF. Columns needed for CSV: Name, Qty Sold, Revenue. PDFs are processed with AI."
        badge="CSV or PDF"
        badgeColour="#1b4f72"
        accept=".csv,.pdf"
        onFiles={handleFileB}
      >
        {bError && <p className={styles.error}>{bError}</p>}

        {/* PDF processing states */}
        {(bPdfStatus === 'uploading' || bPdfStatus === 'processing') && (
          <div className={styles.preview}>
            <p className={styles.previewTitle}>
              {bPdfStatus === 'uploading' ? '⬆ Uploading PDF…' : '🔍 Extracting sales data with AI…'}
            </p>
          </div>
        )}
        {bPdfError && <p className={styles.error}>{bPdfError}</p>}
        {/* ── Conflict screen (PDF or CSV — shown when overlap detected, nothing written yet) ── */}
        {bConflict && (
          <div className={styles.preview}>
            <div style={{ background: '#fef3c7', borderRadius: 8, border: '1.5px solid #fde68a', padding: 12, marginBottom: 12 }}>
              <p style={{ fontWeight: 700, fontSize: 13, color: '#92400e', marginBottom: 4 }}>Period overlap detected</p>
              <p style={{ fontSize: 12, color: '#78350f', lineHeight: 1.6 }}>
                This upload covers{' '}
                <strong>{fmtDisplayDate(bConflict.start)} – {fmtDisplayDate(bConflict.end)}</strong>
                {', which overlaps with '}
                {bConflict.reports.length === 1 ? 'an existing report' : `${bConflict.reports.length} existing reports`}
                {'. Choose how to proceed.'}
              </p>
            </div>
            {bConflict.reports.map(c => (
              <div key={c.id} style={{ border: '1.5px solid #e5e7eb', borderRadius: 8, padding: 12, marginBottom: 8, background: '#f9fafb' }}>
                <p style={{ fontWeight: 700, fontSize: 13, color: '#111827', marginBottom: 2 }}>
                  {fmtDisplayDate(c.periodStart)} – {fmtDisplayDate(c.periodEnd)}
                </p>
                <p style={{ fontSize: 12, color: '#6b7280' }}>
                  {(c.source || 'csv').toUpperCase()}
                  {' · '}{c.lineCount} line{c.lineCount !== 1 ? 's' : ''}
                  {c.totalRevenue != null ? ` · $${c.totalRevenue.toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} revenue` : ''}
                </p>
                <p style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
                  Uploaded {c.createdAt ? c.createdAt.toLocaleDateString('en-NZ') : '—'}
                </p>
              </div>
            ))}
            {bConflictKeepBothConfirm ? (
              <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, padding: 12, marginTop: 8 }}>
                <p style={{ fontWeight: 700, fontSize: 13, color: '#991b1b', marginBottom: 6 }}>Are you sure?</p>
                <p style={{ fontSize: 12, color: '#7f1d1d', lineHeight: 1.6, marginBottom: 10 }}>
                  Keeping both reports will double-count sales for the overlapping period in Waste Control calculations. Only do this if the reports genuinely cover different items (e.g. different venue areas or POS terminals).
                </p>
                <div className={styles.actions}>
                  <button className={styles.cancelBtn} onClick={() => setBConflictKeepBothConfirm(false)}>Go back</button>
                  <button
                    style={{ padding: '8px 16px', borderRadius: 8, background: '#dc2626', color: '#fff', fontWeight: 700, border: 'none', cursor: 'pointer', fontSize: 13 }}
                    onClick={() => doSalesWrite({ source: bConflict.source, start: bConflict.start, end: bConflict.end, idsToSupersede: [] })}
                  >
                    Yes, keep both reports
                  </button>
                </div>
              </div>
            ) : (
              <div className={styles.actions}>
                <button className={styles.cancelBtn} onClick={() => { setBConflict(null); setBConflictKeepBothConfirm(false) }}>
                  ← Cancel upload
                </button>
                <button
                  style={{ padding: '8px 16px', borderRadius: 8, background: '#fff', color: '#92400e', fontWeight: 700, border: '1.5px solid #f59e0b', cursor: 'pointer', fontSize: 13 }}
                  onClick={() => setBConflictKeepBothConfirm(true)}
                >
                  Keep both (unusual — may double-count)
                </button>
                <button
                  className={styles.confirmBtn}
                  onClick={() => doSalesWrite({ source: bConflict.source, start: bConflict.start, end: bConflict.end, idsToSupersede: bConflict.reports.map(r => r.id) })}
                >
                  Replace existing report{bConflict.reports.length > 1 ? 's' : ''}
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── PDF ready: data preview + editable period picker ── */}
        {(bPdfStatus === 'ready' || bPdfStatus === 'importing') && bPdfLines.length > 0 && !bConflict && (
          <div className={styles.preview}>
            <p className={styles.previewTitle}>{bPdfLines.length} sales lines extracted from PDF</p>
            <div className={styles.tableWrap} style={{ marginTop: 8 }}>
              <table className={styles.table}>
                <thead><tr><th>Product</th><th>Qty Sold</th><th>Gross</th></tr></thead>
                <tbody>
                  {bPdfLines.slice(0, 20).map((l: any, i: number) => (
                    <tr key={i}>
                      <td>{l.name}</td>
                      <td>{l.qtySold}</td>
                      <td>{l.gross != null ? `$${Number(l.gross).toFixed(2)}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Period picker — required; pre-filled from OCR but always editable */}
            <div style={{ marginTop: 12, padding: 12, background: '#eff6ff', borderRadius: 8, border: '1.5px solid #bfdbfe' }}>
              <p style={{ fontWeight: 700, fontSize: 13, color: '#1d4ed8', marginBottom: 4 }}>Confirm report period (required)</p>
              <p style={{ fontSize: 12, color: '#374151', lineHeight: 1.5, marginBottom: 10 }}>
                {(bPdfPeriod.start || bPdfPeriod.end)
                  ? 'Period was detected from the PDF — confirm or correct before importing.'
                  : 'The PDF had no readable dates. Select the date range this report covers.'}
              </p>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' as const }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>
                  Period start
                  <input type="date" value={bPeriodStart} onChange={e => { setBPeriodStart(e.target.value); setBPeriodError(null) }}
                    style={{ display: 'block', marginTop: 4, padding: '5px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }} />
                </label>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>
                  Period end
                  <input type="date" value={bPeriodEnd} min={bPeriodStart} onChange={e => { setBPeriodEnd(e.target.value); setBPeriodError(null) }}
                    style={{ display: 'block', marginTop: 4, padding: '5px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }} />
                </label>
              </div>
              {bPeriodError && <p style={{ fontSize: 12, color: '#dc2626', marginTop: 6 }}>{bPeriodError}</p>}
            </div>
            <div className={styles.actions}>
              <button className={styles.cancelBtn} onClick={() => { setBPdfStatus('idle'); setBPdfLines([]); setBPdfError(null); setBPeriodStart(''); setBPeriodEnd(''); setBPeriodError(null) }}>Cancel</button>
              <button className={styles.confirmBtn} onClick={() => handleSalesPeriodConfirm('pdf')} disabled={bPdfStatus === 'importing'}>
                {bPdfStatus === 'importing' ? 'Importing…' : `Confirm period & import ${bPdfLines.length} lines`}
              </button>
            </div>
          </div>
        )}
        {bPdfStatus === 'done' && (
          <div>
            <p className={styles.success}>✓ Sales data imported from PDF. Analytics will use this data.</p>
            {bSalesWarning && <p style={{ fontSize: 12, color: '#92400e', background: '#fef3c7', borderRadius: 6, padding: '8px 12px', marginTop: 6 }}>{bSalesWarning}</p>}
          </div>
        )}

        {/* ── CSV ready: data preview + period picker ── */}
        {(bStatus === 'ready' || bStatus === 'importing') && !bConflict && (
          <div className={styles.preview}>
            <p className={styles.previewTitle}>{bRows.length} sales lines found</p>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr><th>Name</th><th>Qty</th><th>Revenue</th></tr>
                </thead>
                <tbody>
                  {bRows.slice(0, 20).map((r, i) => (
                    <tr key={i}>
                      <td>{r.name}</td>
                      <td>{r.qty}</td>
                      <td>{r.revenue != null ? `$${r.revenue}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {bRows.length > 20 && (
              <p className={styles.dropAreaHint} style={{ marginTop: 6 }}>
                Showing first 20 of {bRows.length}
              </p>
            )}
            {/* Period picker — required; CSV has no auto-detected dates */}
            <div style={{ marginTop: 12, padding: 12, background: '#eff6ff', borderRadius: 8, border: '1.5px solid #bfdbfe' }}>
              <p style={{ fontWeight: 700, fontSize: 13, color: '#1d4ed8', marginBottom: 4 }}>Set report period (required)</p>
              <p style={{ fontSize: 12, color: '#374151', lineHeight: 1.5, marginBottom: 10 }}>
                Select the date range this CSV covers — needed to match it against stocktake cycles.
              </p>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' as const }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>
                  Period start
                  <input type="date" value={bPeriodStart} onChange={e => { setBPeriodStart(e.target.value); setBPeriodError(null) }}
                    style={{ display: 'block', marginTop: 4, padding: '5px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }} />
                </label>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>
                  Period end
                  <input type="date" value={bPeriodEnd} min={bPeriodStart} onChange={e => { setBPeriodEnd(e.target.value); setBPeriodError(null) }}
                    style={{ display: 'block', marginTop: 4, padding: '5px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }} />
                </label>
              </div>
              {bPeriodError && <p style={{ fontSize: 12, color: '#dc2626', marginTop: 6 }}>{bPeriodError}</p>}
            </div>
            <div className={styles.actions}>
              <button
                className={styles.cancelBtn}
                onClick={() => { setBRows([]); setBStatus('idle'); setBError(null); setBPeriodStart(''); setBPeriodEnd(''); setBPeriodError(null) }}
              >
                Cancel
              </button>
              <button
                className={styles.confirmBtn}
                onClick={() => handleSalesPeriodConfirm('csv')}
                disabled={bStatus === 'importing'}
              >
                {bStatus === 'importing' ? 'Importing…' : `Confirm period & import ${bRows.length} lines`}
              </button>
              <button className={styles.cancelBtn} onClick={downloadSalesTemplate}>
                Download template
              </button>
            </div>
          </div>
        )}
        {bStatus === 'done' && (
          <div>
            <p className={styles.success}>✓ Sales data imported. Analytics will use this data.</p>
            {bSalesWarning && <p style={{ fontSize: 12, color: '#92400e', background: '#fef3c7', borderRadius: 6, padding: '8px 12px', marginTop: 6 }}>{bSalesWarning}</p>}
          </div>
        )}
      </DropZone>

      {/* ── Zone C — Supplier Invoice ── */}
      <DropZone
        title="Supplier Invoice"
        description="Import a supplier invoice — drag a CSV or PDF. PDFs are processed with AI to extract product lines automatically."
        badge="CSV or PDF"
        badgeColour="#1b4f72"
        accept=".csv,.pdf"
        onFiles={handleFileC}
      >
        {cError && <p className={styles.error}>{cError}</p>}

        {/* PDF processing states */}
        {(cPdfStatus === 'uploading' || cPdfStatus === 'processing') && (
          <div className={styles.preview}>
            <p className={styles.previewTitle}>
              {cPdfStatus === 'uploading' ? '⬆ Uploading PDF…' : '🔍 Extracting invoice data with AI…'}
            </p>
            <p style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
              {cPdfStatus === 'processing' ? 'This usually takes 10–20 seconds for a digital PDF.' : ''}
            </p>
          </div>
        )}
        {cPdfError && (
          <div className={styles.error} style={{ marginTop: 10 }}>
            {cPdfError}
            {' '}
            <button type="button" style={{ background: 'none', border: 'none', color: '#1b4f72', cursor: 'pointer', textDecoration: 'underline', fontSize: 13 }}
              onClick={() => { setCPdfError(null); setCPdfStatus('idle'); setCPdfLines([]) }}>
              Try again
            </button>
          </div>
        )}
        {(cPdfStatus === 'ready' || cPdfStatus === 'importing') && cPdfLines.length > 0 && (
          <div className={styles.preview}>
            <p className={styles.previewTitle}>{cPdfLines.length} product lines extracted from PDF</p>
            {cPdfSupplier && <p className={styles.deduplicateSummary}>Supplier: {cPdfSupplier}</p>}
            <div style={{ marginTop: 8, marginBottom: 4 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 4 }}>
                Confirm supplier name
              </label>
              <input value={cPdfSupplier} onChange={e => setCPdfSupplier(e.target.value)} placeholder="e.g. Pacific Beverages NZ Ltd"
                style={{ width: '100%', padding: '6px 10px', border: '1px solid #e5e3de', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' as const }} />
            </div>
            <div className={styles.tableWrap} style={{ marginTop: 8 }}>
              <table className={styles.table}>
                <thead><tr><th>Product</th><th>Qty</th><th>Unit Price</th></tr></thead>
                <tbody>
                  {cPdfLines.slice(0, 20).map((l, i) => (
                    <tr key={i}>
                      <td>{l.name}</td>
                      <td>{l.qty}</td>
                      <td>{l.unitPrice != null ? `$${Number(l.unitPrice).toFixed(2)}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className={styles.actions}>
              <button className={styles.cancelBtn} onClick={() => { setCPdfStatus('idle'); setCPdfLines([]); setCPdfError(null); setCPdfInvoiceMeta({}) }}>Cancel</button>
              <button className={styles.confirmBtn} onClick={handleImportPdf} disabled={cPdfStatus === 'importing'}>
                {cPdfStatus === 'importing' ? 'Importing…' : `Import ${cPdfLines.length} products`}
              </button>
            </div>
          </div>
        )}
        {cPdfStatus === 'done' && (
          <p className={styles.success}>
            ✓ {cPdfLines.length} products imported from PDF. Cost prices and supplier updated.
          </p>
        )}
        {(cStatus === 'ready' || cStatus === 'importing') && (
          <div className={styles.preview}>
            <p className={styles.previewTitle}>{cRows.length} invoice lines found</p>
            {cSupplierName && (
              <p className={styles.deduplicateSummary}>
                Supplier: {cSupplierName} — {cSupplierFound ? 'matches existing supplier' : 'will be created'}
              </p>
            )}
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr><th>Name</th><th>Qty</th><th>Unit Price</th></tr>
                </thead>
                <tbody>
                  {cRows.slice(0, 20).map((r, i) => (
                    <tr key={i}>
                      <td>{r.name}</td>
                      <td>{r.qty ?? '—'}</td>
                      <td>{r.costPrice != null ? `$${r.costPrice}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {cRows.length > 20 && (
              <p className={styles.dropAreaHint} style={{ marginTop: 6 }}>
                Showing first 20 of {cRows.length}
              </p>
            )}
            <div className={styles.supplierInput}>
              <label>Supplier name:</label>
              <input
                value={cSupplierName}
                onChange={e => setCSupplierName(e.target.value)}
                placeholder="e.g. Hancocks"
              />
            </div>
            {cIsDuplicate && !cIgnoreDuplicate && (
              <div className={styles.duplicateWarning}>
                ⚠️ This invoice looks like it may have been imported before
                {cDuplicateDate ? ` (${cDuplicateDate})` : ' (previously)'}.
                <button type="button" onClick={() => setCIgnoreDuplicate(true)}>Import anyway</button>
              </div>
            )}
            <div className={styles.actions}>
              <button
                className={styles.cancelBtn}
                onClick={() => { setCRows([]); setCStatus('idle'); setCError(null); setCIsDuplicate(false); setCIgnoreDuplicate(false) }}
              >
                Cancel
              </button>
              <button
                className={styles.confirmBtn}
                onClick={handleImportC}
                disabled={cStatus === 'importing' || (cIsDuplicate && !cIgnoreDuplicate)}
              >
                {cStatus === 'importing' ? 'Importing…' : `Update ${cRows.length} products`}
              </button>
            </div>
          </div>
        )}
        {cStatus === 'done' && (
          <p className={styles.success}>
            ✓ {cRows.length} products updated with costs from {cSupplierName || 'supplier'}.
          </p>
        )}
      </DropZone>

      {/* ── Zone D — Supplier Catalogue ── */}
      <DropZone
        title="Supplier Catalogue"
        description="Import a supplier price list to update costs and flag any price changes. Columns needed: Name/Product, Price/Cost."
        badge="Optional"
        badgeColour="#6b7280"
        onFiles={handleFileD}
      >
        {dError && <p className={styles.error}>{dError}</p>}
        {(dStatus === 'ready' || dStatus === 'importing') && (
          <div className={styles.preview}>
            <p className={styles.previewTitle}>{dRows.length} products found</p>
            {dSupplierName.trim() && (
              <p className={styles.deduplicateSummary}>
                {dSupplierMatch
                  ? `Updating prices for existing supplier: ${dSupplierName.trim()}`
                  : `New supplier will be created: ${dSupplierName.trim()}`}
              </p>
            )}
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr><th>Product</th><th>Current</th><th>New</th><th>Change %</th></tr>
                </thead>
                <tbody>
                  {dRows.slice(0, 20).map((r, i) => {
                    const changePercent = r.currentCost != null && r.currentCost !== 0
                      ? (((r.price - r.currentCost) / r.currentCost) * 100).toFixed(1)
                      : null
                    const rowClass = r.isNew
                      ? styles.newRow
                      : r.currentCost !== r.price
                        ? styles.changeRow
                        : ''
                    return (
                      <tr key={i} className={rowClass}>
                        <td>{r.name}</td>
                        <td>{r.currentCost != null ? `$${r.currentCost}` : '—'}</td>
                        <td>${r.price}</td>
                        <td>{changePercent != null ? `${changePercent}%` : r.isNew ? 'New' : '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {dRows.length > 20 && (
              <p className={styles.dropAreaHint} style={{ marginTop: 6 }}>
                Showing first 20 of {dRows.length}
              </p>
            )}
            <div className={styles.supplierInput}>
              <label>Supplier name:</label>
              <input
                value={dSupplierName}
                onChange={e => setDSupplierName(e.target.value)}
                placeholder="e.g. Hancocks"
              />
            </div>
            <div className={styles.actions}>
              <button
                className={styles.cancelBtn}
                onClick={() => { setDRows([]); setDStatus('idle'); setDError(null) }}
              >
                Cancel
              </button>
              <button
                className={styles.confirmBtn}
                onClick={handleImportD}
                disabled={dStatus === 'importing'}
              >
                {dStatus === 'importing' ? 'Importing…' : `Update ${dRows.length} products`}
              </button>
            </div>
          </div>
        )}
        {dStatus === 'done' && (
          <p className={styles.success}>
            ✓ {dRows.length} products updated.{' '}
            {dRows.filter(r => !r.isNew && r.currentCost !== r.price).length} price change
            {dRows.filter(r => !r.isNew && r.currentCost !== r.price).length !== 1 ? 's' : ''} flagged for review in Reports → Price Changes.
          </p>
        )}
      </DropZone>
    </div>
  )
}
