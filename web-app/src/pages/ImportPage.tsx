import { useEffect, useRef, useState } from 'react'
import {
  addDoc, collection, doc, getDoc, getDocs, serverTimestamp, setDoc, writeBatch, updateDoc,
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
  const match = snap.docs.find(d => {
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
  const [aExistingMap, setAExistingMap] = useState<Map<string, string>>(new Map())
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
      const existingMap = aExistingMap.size > 0 ? aExistingMap : await loadExistingProducts(venueId)
      await batchWrite(db, `venues/${venueId}/products`,
        aRows.map(r => ({
          id: existingMap.get(r.name.toLowerCase().trim()) ?? slugId(r.name),
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
            updatedAt: serverTimestamp(),
          },
        }))
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
  const [bPdfStatus, setBPdfStatus] = useState<'idle'|'uploading'|'processing'|'ready'|'done'>('idle')
  const [bPdfLines, setBPdfLines] = useState<any[]>([])
  const [bPdfError, setBPdfError] = useState<string|null>(null)
  const [bPdfPeriod, setBPdfPeriod] = useState<{start?:string|null;end?:string|null}>({})

  async function handleImportBPdf() {
    if (!bPdfLines.length) return
    setBPdfStatus('done') // optimistic — writes are fast
    try {
      await addDoc(collection(db, 'venues', venueId, 'salesReports'), {
        source: 'pdf',
        importedAt: serverTimestamp(),
        lineCount: bPdfLines.length,
        period: bPdfPeriod,
        lines: bPdfLines,
      })
      await updateDoc(doc(db, 'venues', venueId), { onboardingHasSales: true })
    } catch {
      setBPdfError('Import failed. Please try again.')
      setBPdfStatus('idle')
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
      setBStatus('ready')
    } catch {
      setBError('Failed to read file.')
    }
  }

  async function handleImportB() {
    setBStatus('importing')
    try {
      await addDoc(collection(db, 'venues', venueId, 'salesReports'), {
        source: 'csv-desktop',
        importedAt: serverTimestamp(),
        lineCount: bRows.length,
        lines: bRows,
      })
      await updateDoc(doc(db, 'venues', venueId), { onboardingHasSales: true })
      setBStatus('done')
    } catch {
      setBError('Import failed. Please try again.')
      setBStatus('error')
    }
  }

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
          source: 'desktop-import',
        })
      }

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
      const existingMap = await loadExistingProducts(venueId)
      const supplierName = cPdfSupplier.trim() || 'Unassigned'

      // Find or create supplier
      let supplierId: string | null = null
      if (supplierName !== 'Unassigned') {
        const suppliersSnap = await getDocs(collection(db, 'venues', venueId, 'suppliers'))
        const existing = suppliersSnap.docs.find(d =>
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
      snap.docs.forEach(d => {
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
        {bPdfStatus === 'ready' && bPdfLines.length > 0 && (
          <div className={styles.preview}>
            <p className={styles.previewTitle}>{bPdfLines.length} sales lines extracted from PDF</p>
            {(bPdfPeriod.start || bPdfPeriod.end) && (
              <p className={styles.deduplicateSummary}>
                Period: {bPdfPeriod.start || '?'} → {bPdfPeriod.end || '?'}
              </p>
            )}
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
            <div className={styles.actions}>
              <button className={styles.confirmBtn} onClick={handleImportBPdf}>
                Import {bPdfLines.length} sales lines
              </button>
              <button className={styles.cancelBtn} onClick={() => { setBPdfStatus('idle'); setBPdfLines([]); setBPdfError(null) }}>
                Cancel
              </button>
            </div>
          </div>
        )}
        {bPdfStatus === 'done' && (
          <p className={styles.success}>✓ Sales data imported from PDF. Suggested Orders will use this data.</p>
        )}
        {(bStatus === 'ready' || bStatus === 'importing') && (
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
            <div className={styles.actions}>
              <button
                className={styles.cancelBtn}
                onClick={() => { setBRows([]); setBStatus('idle'); setBError(null) }}
              >
                Cancel
              </button>
              <button
                className={styles.confirmBtn}
                onClick={handleImportB}
                disabled={bStatus === 'importing'}
              >
                {bStatus === 'importing' ? 'Importing…' : `Import ${bRows.length} sales lines`}
              </button>
              <button className={styles.cancelBtn} onClick={downloadSalesTemplate}>
                Download template
              </button>
            </div>
          </div>
        )}
        {bStatus === 'done' && (
          <p className={styles.success}>
            ✓ Sales data imported. Suggested orders will use this to calibrate recommendations.
          </p>
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
              <button className={styles.cancelBtn} onClick={() => { setCPdfStatus('idle'); setCPdfLines([]); setCPdfError(null) }}>Cancel</button>
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
