import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore'
import { auth, db } from '../firebase'
import styles from './SetupProductsPage.module.css'

type Product = {
  id: string
  name: string
  category: string | null
  unit: string | null
  packSize: number | null
  costPrice: number | null
  supplierName: string | null
  parLevel: number | null
  gstPercent: number | null
}

type MatchCandidate = {
  id: string
  newProductId: string
  newProductName: string
  candidateProductId: string
  candidateProductName: string
  confidence: number
  createdAt: any
}

type EditableField = 'name' | 'category' | 'unit' | 'packSize' | 'costPrice' | 'supplierName' | 'parLevel'

const COLUMNS: { field: EditableField; label: string }[] = [
  { field: 'name',         label: 'Name' },
  { field: 'category',     label: 'Category' },
  { field: 'unit',         label: 'Unit' },
  { field: 'packSize',     label: 'Pack Size' },
  { field: 'costPrice',    label: 'Cost Price' },
  { field: 'supplierName', label: 'Supplier' },
  { field: 'parLevel',     label: 'PAR' },
]

// Matches the mobile app's isIncomplete logic — name, category, unit, pack
// size, GST%, and a real supplier (not the "Unassigned" placeholder) must all
// be set. parLevel being null does NOT make a product incomplete.
function isIncomplete(p: Product): boolean {
  if (!p.name) return true
  if (!p.category) return true
  if (!p.unit) return true
  if (!p.packSize) return true
  if (p.gstPercent == null) return true
  if (!p.supplierName || p.supplierName === 'Unassigned') return true
  return false
}

function normaliseName(s: string): string {
  return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

function findDuplicatePairs(products: Product[]): Array<[Product, Product]> {
  const pairs: Array<[Product, Product]> = []
  const seen = new Set<string>()

  for (let i = 0; i < products.length; i++) {
    for (let j = i + 1; j < products.length; j++) {
      const a = products[i]
      const b = products[j]
      const pairKey = [a.id, b.id].sort().join(':')
      if (seen.has(pairKey)) continue

      const na = normaliseName(a.name)
      const nb = normaliseName(b.name)
      if (!na || !nb || na.length < 4 || nb.length < 4) continue

      const exactMatch = na === nb
      const subMatch =
        (na.includes(nb) || nb.includes(na)) &&
        Math.min(na.length, nb.length) >= 5
      const shorter = na.length < nb.length ? na : nb
      const longer = na.length >= nb.length ? na : nb
      let si = 0, matches = 0
      for (let li = 0; li < longer.length && si < shorter.length; li++) {
        if (longer[li] === shorter[si]) { matches++; si++ }
      }
      const seqMatch = matches / shorter.length >= 0.85

      if (exactMatch || subMatch || seqMatch) {
        pairs.push([a, b])
        seen.add(pairKey)
      }
    }
  }
  return pairs
}

function displayValue(p: Product, field: EditableField): string {
  switch (field) {
    case 'name':         return p.name || ''
    case 'category':     return p.category || ''
    case 'unit':         return p.unit || ''
    case 'packSize':     return p.packSize != null ? String(p.packSize) : ''
    case 'costPrice':    return p.costPrice != null ? p.costPrice.toFixed(2) : ''
    case 'supplierName': return p.supplierName && p.supplierName !== 'Unassigned' ? p.supplierName : ''
    case 'parLevel':     return p.parLevel != null ? String(p.parLevel) : ''
  }
}

function buildUpdatePayload(field: EditableField, raw: string): Record<string, unknown> {
  const trimmed = raw.trim()
  switch (field) {
    case 'name':
      return { name: trimmed, updatedAt: serverTimestamp() }
    case 'unit':
      return { unit: trimmed || null, updatedAt: serverTimestamp() }
    case 'packSize': {
      const n = trimmed === '' ? null : Math.round(Number(trimmed))
      const val = n != null && Number.isFinite(n) ? n : null
      // caseSize is the field name the mobile app's prediction/packing-slip
      // code reads — kept as an alias of packSize, same as EditProductScreen.
      return { packSize: val, caseSize: val, updatedAt: serverTimestamp() }
    }
    case 'costPrice': {
      const n = trimmed === '' ? null : Number(trimmed)
      return { costPrice: n != null && Number.isFinite(n) ? n : null, updatedAt: serverTimestamp() }
    }
    case 'supplierName':
      // "Unassigned" is the mobile app's convention for "no supplier set".
      return { supplierName: trimmed || 'Unassigned', updatedAt: serverTimestamp() }
    case 'category':
      return { category: trimmed || null, updatedAt: serverTimestamp() }
    case 'parLevel': {
      const n = trimmed === '' ? null : Number(trimmed)
      return { parLevel: n != null && Number.isFinite(n) && n >= 0 ? n : null, updatedAt: serverTimestamp() }
    }
  }
}

function getAdjacentCell(
  rows: Product[],
  id: string,
  field: EditableField,
  dir: 1 | -1
): { id: string; field: EditableField } | null {
  const rowIdx = rows.findIndex((r) => r.id === id)
  if (rowIdx === -1) return null
  const colIdx = COLUMNS.findIndex((c) => c.field === field)
  let nextCol = colIdx + dir
  let nextRow = rowIdx
  if (nextCol >= COLUMNS.length) {
    nextCol = 0
    nextRow += 1
  } else if (nextCol < 0) {
    nextCol = COLUMNS.length - 1
    nextRow -= 1
  }
  if (nextRow < 0 || nextRow >= rows.length) return null
  return { id: rows[nextRow].id, field: COLUMNS[nextCol].field }
}

// ─── Minimal CSV parsing — handles quoted fields with embedded commas ────────

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      field = ''
      rows.push(row)
      row = []
    } else {
      field += ch
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''))
}

type CsvRow = {
  name: string
  unit: string
  packSize: number | null
  costPrice: number | null
  supplierName: string
}

function mapCsvRows(rows: string[][]): { parsed: CsvRow[]; error: string | null } {
  if (rows.length === 0) return { parsed: [], error: 'The file is empty.' }
  const header = rows[0].map((h) => h.trim().toLowerCase())
  const nameIdx = header.findIndex((h) => h === 'name')
  const unitIdx = header.findIndex((h) => h === 'unit')
  const packSizeIdx = header.findIndex((h) => h === 'pack size' || h === 'packsize')
  const costPriceIdx = header.findIndex((h) => h === 'cost price' || h === 'costprice')
  const supplierIdx = header.findIndex(
    (h) => h === 'supplier' || h === 'supplier name' || h === 'suppliername'
  )

  if (nameIdx === -1) return { parsed: [], error: 'CSV must include a "Name" column.' }

  const parsed = rows
    .slice(1)
    .map((r) => ({
      name: (r[nameIdx] || '').trim(),
      unit: unitIdx >= 0 ? (r[unitIdx] || '').trim() : '',
      packSize:
        packSizeIdx >= 0 && (r[packSizeIdx] || '').trim() !== ''
          ? Math.round(Number(r[packSizeIdx]))
          : null,
      costPrice:
        costPriceIdx >= 0 && (r[costPriceIdx] || '').trim() !== '' ? Number(r[costPriceIdx]) : null,
      supplierName: supplierIdx >= 0 ? (r[supplierIdx] || '').trim() : '',
    }))
    .filter((r) => r.name)

  return { parsed, error: parsed.length === 0 ? 'No valid rows found — each row needs a Name.' : null }
}

export default function SetupProductsPage({ venueId }: { venueId: string }) {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sortField, setSortField] = useState<EditableField | 'status'>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const [editingCell, setEditingCell] = useState<{ id: string; field: EditableField } | null>(null)
  const [editValue, setEditValue] = useState('')
  const [pinnedNewId, setPinnedNewId] = useState<string | null>(null)
  const skipNextBlur = useRef(false)
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({})

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [csvFileName, setCsvFileName] = useState<string | null>(null)
  const [csvRows, setCsvRows] = useState<CsvRow[] | null>(null)
  const [csvError, setCsvError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    setLoading(true)
    const unsub = onSnapshot(
      collection(db, 'venues', venueId, 'products'),
      (snap) => {
        setProducts(
          snap.docs.map((d) => {
            const data = d.data() as any
            return {
              id: d.id,
              name: data.name || '',
              category: data.category ?? null,
              unit: data.unit ?? null,
              packSize: data.packSize ?? null,
              costPrice: data.costPrice ?? null,
              supplierName: data.supplierName ?? null,
              parLevel: data.parLevel ?? null,
              gstPercent: data.gstPercent ?? null,
            }
          })
        )
        setLoading(false)
      },
      () => setLoading(false)
    )
    return unsub
  }, [venueId])

  // Focus the active cell's input once it's rendered (handles both clicking
  // a cell, and the auto-focus on a freshly-added row arriving via onSnapshot).
  useEffect(() => {
    if (!editingCell) return
    inputRefs.current[`${editingCell.id}:${editingCell.field}`]?.focus()
  }, [editingCell, products])

  // Clear the "pin to top" once the user moves on to a different row.
  useEffect(() => {
    if (pinnedNewId && editingCell && editingCell.id !== pinnedNewId) {
      setPinnedNewId(null)
    }
  }, [editingCell, pinnedNewId])

  function toggleSort(field: EditableField | 'status') {
    if (sortField === field) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortField(field)
      setSortDir('asc')
    }
  }

  const visibleRows = useMemo(() => {
    const needle = search.trim().toLowerCase()
    let rows = products
    if (needle) {
      rows = rows.filter(
        (p) =>
          p.name.toLowerCase().includes(needle) ||
          (p.category || '').toLowerCase().includes(needle) ||
          (p.unit || '').toLowerCase().includes(needle) ||
          (p.supplierName || '').toLowerCase().includes(needle)
      )
    }
    const sorted = [...rows].sort((a, b) => {
      let av: string | number
      let bv: string | number
      if (sortField === 'status') {
        av = isIncomplete(a) ? 1 : 0
        bv = isIncomplete(b) ? 1 : 0
      } else {
        av = a[sortField] ?? ''
        bv = b[sortField] ?? ''
      }
      if (typeof av === 'string') av = av.toLowerCase()
      if (typeof bv === 'string') bv = bv.toLowerCase()
      if (av < bv) return sortDir === 'asc' ? -1 : 1
      if (av > bv) return sortDir === 'asc' ? 1 : -1
      return 0
    })
    if (pinnedNewId) {
      const idx = sorted.findIndex((p) => p.id === pinnedNewId)
      if (idx > 0) {
        const [row] = sorted.splice(idx, 1)
        sorted.unshift(row)
      }
    }
    return sorted
  }, [products, search, sortField, sortDir, pinnedNewId])

  async function commitEdit(id: string, field: EditableField, rawValue: string) {
    try {
      await updateDoc(doc(db, 'venues', venueId, 'products', id), buildUpdatePayload(field, rawValue))
    } catch (e) {
      console.error('[SetupProductsPage] failed to save field', field, e)
    }
  }

  function startEdit(product: Product, field: EditableField) {
    setEditingCell({ id: product.id, field })
    setEditValue(displayValue(product, field))
  }

  function handleBlur() {
    if (skipNextBlur.current) {
      skipNextBlur.current = false
      return
    }
    if (editingCell) commitEdit(editingCell.id, editingCell.field, editValue)
    setEditingCell(null)
  }

  function handleCellKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!editingCell) return
    if (e.key === 'Enter') {
      e.preventDefault()
      skipNextBlur.current = true
      commitEdit(editingCell.id, editingCell.field, editValue)
      setEditingCell(null)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      skipNextBlur.current = true
      setEditingCell(null)
    } else if (e.key === 'Tab') {
      e.preventDefault()
      skipNextBlur.current = true
      commitEdit(editingCell.id, editingCell.field, editValue)
      const next = getAdjacentCell(visibleRows, editingCell.id, editingCell.field, e.shiftKey ? -1 : 1)
      if (next) {
        const nextProduct = visibleRows.find((p) => p.id === next.id)!
        setEditingCell(next)
        setEditValue(displayValue(nextProduct, next.field))
      } else {
        setEditingCell(null)
      }
    }
  }

  async function handleAddProduct() {
    // Pre-generate the doc ref so we know its id before the write resolves —
    // lets us pin the row to the top and start editing it immediately,
    // rather than waiting on the snapshot round-trip.
    const ref = doc(collection(db, 'venues', venueId, 'products'))
    setPinnedNewId(ref.id)
    setEditingCell({ id: ref.id, field: 'name' })
    setEditValue('')
    await setDoc(ref, {
      name: '',
      unit: null,
      packSize: null,
      caseSize: null,
      costPrice: null,
      supplierId: null,
      supplierName: 'Unassigned',
      gstPercent: 15,
      active: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  }

  function handleFiles(files: FileList | null) {
    const file = files?.[0]
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setCsvError('Please upload a .csv file.')
      return
    }
    setCsvFileName(file.name)
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result || '')
      const { parsed, error } = mapCsvRows(parseCsv(text))
      setCsvError(error)
      setCsvRows(error ? null : parsed)
    }
    reader.onerror = () => setCsvError('Could not read file.')
    reader.readAsText(file)
  }

  async function confirmImport() {
    if (!csvRows || csvRows.length === 0) return
    setImporting(true)
    try {
      for (let i = 0; i < csvRows.length; i += 500) {
        const chunk = csvRows.slice(i, i + 500)
        const batch = writeBatch(db)
        for (const row of chunk) {
          const ref = doc(collection(db, 'venues', venueId, 'products'))
          batch.set(ref, {
            name: row.name,
            unit: row.unit || null,
            packSize: row.packSize,
            caseSize: row.packSize,
            costPrice: row.costPrice,
            supplierId: null,
            supplierName: row.supplierName || 'Unassigned',
            gstPercent: 15,
            active: true,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          })
        }
        await batch.commit()
      }
      setCsvRows(null)
      setCsvFileName(null)
    } catch (e: any) {
      setCsvError(e?.message || 'Import failed.')
    } finally {
      setImporting(false)
    }
  }

  function handleExportCsv() {
    const headers = ['Name', 'Category', 'Unit', 'Pack Size', 'Cost Price', 'Supplier', 'PAR', 'Status']
    const rows = visibleRows.map((p) => [
      p.name,
      p.category || '',
      p.unit || '',
      p.packSize != null ? String(p.packSize) : '',
      p.costPrice != null ? p.costPrice.toFixed(2) : '',
      p.supplierName && p.supplierName !== 'Unassigned' ? p.supplierName : '',
      p.parLevel != null ? String(p.parLevel) : '',
      isIncomplete(p) ? 'Incomplete' : 'Complete',
    ])
    const csv = [headers, ...rows]
      .map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `products-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleDeleteProduct(id: string) {
    try {
      await deleteDoc(doc(db, 'venues', venueId, 'products', id))
    } catch (e) {
      console.error('[SetupProductsPage] delete failed', e)
    }
    setConfirmDeleteId(null)
  }

  function renderCell(product: Product, field: EditableField) {
    const isEditing = editingCell?.id === product.id && editingCell.field === field
    if (isEditing) {
      return (
        <input
          ref={(el) => {
            inputRefs.current[`${product.id}:${field}`] = el
          }}
          className={styles.cellInput}
          type={field === 'packSize' || field === 'costPrice' || field === 'parLevel' ? 'number' : 'text'}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={handleCellKeyDown}
        />
      )
    }
    const value = displayValue(product, field)
    return (
      <div
        className={`${styles.cellText} ${!value ? styles.cellTextEmpty : ''}`}
        onClick={() => startEdit(product, field)}
      >
        {value || '—'}
      </div>
    )
  }

  const incompleteCount = useMemo(() => products.filter(isIncomplete).length, [products])
  const missingCostPrice = useMemo(() => products.filter(p => p.costPrice == null).length, [products])
  const missingSupplier = useMemo(() => products.filter(p => !p.supplierName || p.supplierName === 'Unassigned').length, [products])
  const missingUnit = useMemo(() => products.filter(p => !p.unit).length, [products])

  const [dismissedPairs, setDismissedPairs] = useState<Set<string>>(new Set())
  const [showDuplicates, setShowDuplicates] = useState(false)

  const [matchCandidates, setMatchCandidates] = useState<MatchCandidate[]>([])
  const [showCandidates, setShowCandidates] = useState(false)

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'venues', venueId, 'productMatchCandidates'), where('status', '==', 'pending')),
      (snap) => setMatchCandidates(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))),
      () => {}
    )
    return unsub
  }, [venueId])

  async function dismissCandidate(id: string) {
    const user = auth.currentUser
    try {
      await updateDoc(doc(db, 'venues', venueId, 'productMatchCandidates', id), {
        status: 'dismissed',
        reviewedBy: { uid: user?.uid || null, name: user?.displayName || 'Manager' },
        reviewedAt: serverTimestamp(),
      })
    } catch (e) {
      console.error('[SetupProductsPage] dismiss candidate failed', e)
    }
  }

  const duplicatePairs = useMemo(
    () => findDuplicatePairs(products).filter(
      ([a, b]) => !dismissedPairs.has([a.id, b.id].sort().join(':'))
    ),
    [products, dismissedPairs]
  )

  return (
    <div>
      <h1 className={styles.heading}>Products</h1>
      <p className={styles.subhead}>Add and edit products with a real keyboard.</p>

      {incompleteCount > 0 && (
        <div style={{
          background: '#fffbeb',
          border: '1.5px solid #c47b2b',
          borderRadius: 12,
          padding: '14px 16px',
          marginBottom: 20,
          display: 'flex',
          alignItems: 'flex-start',
          gap: 14,
        }}>
          <span style={{ fontSize: 20, marginTop: 2 }}>📋</span>
          <div style={{ flex: 1 }}>
            <p style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 700, color: '#92400e' }}>
              {incompleteCount} product{incompleteCount !== 1 ? 's' : ''} missing details
            </p>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 4 }}>
              {missingCostPrice > 0 && (
                <span style={{ fontSize: 12, color: '#92400e' }}>
                  💰 {missingCostPrice} missing cost price
                </span>
              )}
              {missingSupplier > 0 && (
                <span style={{ fontSize: 12, color: '#92400e' }}>
                  🤝 {missingSupplier} unassigned supplier
                </span>
              )}
              {missingUnit > 0 && (
                <span style={{ fontSize: 12, color: '#92400e' }}>
                  📏 {missingUnit} missing unit
                </span>
              )}
            </div>
            <p style={{ margin: '8px 0 0', fontSize: 12, color: '#92400e', opacity: 0.8 }}>
              Click any product to fill in missing details. Cost prices unlock variance reporting.
            </p>
          </div>
        </div>
      )}

      {duplicatePairs.length > 0 && (
        <div style={{
          background: '#fef2f2',
          border: '1.5px solid #dc2626',
          borderRadius: 12,
          padding: '14px 16px',
          marginBottom: 16,
          display: 'flex',
          alignItems: 'flex-start',
          gap: 14,
        }}>
          <span style={{ fontSize: 20, marginTop: 2 }}>⚠️</span>
          <div style={{ flex: 1 }}>
            <p style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 700, color: '#991b1b' }}>
              {duplicatePairs.length} possible duplicate{duplicatePairs.length !== 1 ? 's' : ''} found
            </p>
            <p style={{ margin: '0 0 10px', fontSize: 12, color: '#991b1b', opacity: 0.85 }}>
              These products have very similar names and may be the same item counted twice.
            </p>
            <button
              onClick={() => setShowDuplicates(v => !v)}
              style={{
                background: 'none',
                border: '1px solid #dc2626',
                borderRadius: 999,
                padding: '5px 14px',
                fontSize: 12,
                fontWeight: 600,
                color: '#dc2626',
                cursor: 'pointer',
              }}
            >
              {showDuplicates ? 'Hide duplicates ↑' : 'Review duplicates →'}
            </button>
          </div>
        </div>
      )}

      {showDuplicates && duplicatePairs.length > 0 && (
        <div style={{
          background: '#fff',
          border: '1px solid #e5e3de',
          borderRadius: 12,
          marginBottom: 20,
          overflow: 'hidden',
        }}>
          <div style={{
            padding: '12px 16px',
            borderBottom: '1px solid #e5e3de',
            background: '#fef2f2',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#991b1b' }}>
              Possible duplicates — review and dismiss or keep both
            </span>
            <button
              onClick={() => setShowDuplicates(false)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#991b1b' }}
            >
              ×
            </button>
          </div>
          {duplicatePairs.map(([a, b]) => {
            const pairKey = [a.id, b.id].sort().join(':')
            return (
              <div key={pairKey} style={{
                padding: '12px 16px',
                borderBottom: '1px solid #f0ede6',
                display: 'grid',
                gridTemplateColumns: '1fr 40px 1fr auto',
                gap: 12,
                alignItems: 'center',
              }}>
                <div>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#0B132B' }}>
                    {a.name}
                  </p>
                  <p style={{ margin: '2px 0 0', fontSize: 11, color: '#6B7280' }}>
                    {[a.supplierName, a.unit, a.costPrice != null ? `$${a.costPrice}` : null].filter(Boolean).join(' · ') || 'No details'}
                  </p>
                </div>
                <div style={{ textAlign: 'center', fontSize: 11, color: '#6B7280' }}>vs</div>
                <div>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#0B132B' }}>
                    {b.name}
                  </p>
                  <p style={{ margin: '2px 0 0', fontSize: 11, color: '#6B7280' }}>
                    {[b.supplierName, b.unit, b.costPrice != null ? `$${b.costPrice}` : null].filter(Boolean).join(' · ') || 'No details'}
                  </p>
                </div>
                <button
                  onClick={() => setDismissedPairs(prev => new Set([...prev, pairKey]))}
                  title="Not a duplicate — dismiss"
                  style={{
                    background: 'none',
                    border: '1px solid #e5e3de',
                    borderRadius: 8,
                    padding: '4px 10px',
                    fontSize: 11,
                    color: '#6B7280',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  Not a duplicate
                </button>
              </div>
            )
          })}
        </div>
      )}

      {matchCandidates.length > 0 && (
        <div style={{
          background: '#fffbeb',
          border: '1.5px solid #c47b2b',
          borderRadius: 12,
          padding: '14px 16px',
          marginBottom: 16,
          display: 'flex',
          alignItems: 'flex-start',
          gap: 14,
        }}>
          <span style={{ fontSize: 20, marginTop: 2 }}>🔍</span>
          <div style={{ flex: 1 }}>
            <p style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 700, color: '#92400e' }}>
              {matchCandidates.length} possible match{matchCandidates.length !== 1 ? 'es' : ''} from counting
            </p>
            <p style={{ margin: '0 0 10px', fontSize: 12, color: '#92400e', opacity: 0.85 }}>
              These products were created during a stock count and may already exist under a similar name.
            </p>
            <button
              onClick={() => setShowCandidates(v => !v)}
              style={{
                background: 'none',
                border: '1px solid #c47b2b',
                borderRadius: 999,
                padding: '5px 14px',
                fontSize: 12,
                fontWeight: 600,
                color: '#92400e',
                cursor: 'pointer',
              }}
            >
              {showCandidates ? 'Hide matches ↑' : 'Review matches →'}
            </button>
          </div>
        </div>
      )}

      {showCandidates && matchCandidates.length > 0 && (
        <div style={{
          background: '#fff',
          border: '1px solid #e5e3de',
          borderRadius: 12,
          marginBottom: 20,
          overflow: 'hidden',
        }}>
          <div style={{
            padding: '12px 16px',
            borderBottom: '1px solid #e5e3de',
            background: '#fffbeb',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#92400e' }}>
              Possible matches from counting — keep both or dismiss
            </span>
            <button
              onClick={() => setShowCandidates(false)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#92400e' }}
            >
              ×
            </button>
          </div>
          {matchCandidates.map((c) => (
            <div key={c.id} style={{
              padding: '12px 16px',
              borderBottom: '1px solid #f0ede6',
              display: 'grid',
              gridTemplateColumns: '1fr 60px 1fr auto',
              gap: 12,
              alignItems: 'center',
            }}>
              <div>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#0B132B' }}>
                  {c.newProductName}
                </p>
                <p style={{ margin: '2px 0 0', fontSize: 11, color: '#6B7280' }}>New from count</p>
              </div>
              <div style={{ textAlign: 'center', fontSize: 11, color: '#6B7280' }}>
                <div>vs</div>
                <div style={{ marginTop: 2, fontWeight: 600, color: '#c47b2b' }}>
                  {Math.round(c.confidence * 100)}%
                </div>
              </div>
              <div>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#0B132B' }}>
                  {c.candidateProductName}
                </p>
                <p style={{ margin: '2px 0 0', fontSize: 11, color: '#6B7280' }}>Existing product</p>
              </div>
              <button
                onClick={() => dismissCandidate(c.id)}
                title="Keep both as separate products"
                style={{
                  background: 'none',
                  border: '1px solid #e5e3de',
                  borderRadius: 8,
                  padding: '4px 10px',
                  fontSize: 11,
                  color: '#6B7280',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                Keep both
              </button>
            </div>
          ))}
        </div>
      )}

      <div className={styles.importSection}>
        <p className={styles.importLabel}>Bulk import from CSV</p>
        <div
          className={`${styles.dropZone} ${dragActive ? styles.dropZoneActive : ''}`}
          onDragOver={(e) => {
            e.preventDefault()
            setDragActive(true)
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragActive(false)
            handleFiles(e.dataTransfer.files)
          }}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            hidden
            onChange={(e) => handleFiles(e.target.files)}
          />
          <p className={styles.dropZoneTitle}>Drag a CSV here, or click to upload</p>
          <p className={styles.dropZoneHint}>Columns: Name, Unit, Pack Size, Cost Price, Supplier</p>
        </div>
        {csvError && <p className={styles.csvError}>{csvError}</p>}

        {csvRows && (
          <div className={styles.csvPreview}>
            <p className={styles.csvPreviewTitle}>
              {csvRows.length} row{csvRows.length !== 1 ? 's' : ''} parsed from {csvFileName}
            </p>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Unit</th>
                    <th>Pack Size</th>
                    <th>Cost Price</th>
                    <th>Supplier</th>
                  </tr>
                </thead>
                <tbody>
                  {csvRows.slice(0, 20).map((row, i) => (
                    <tr key={i}>
                      <td className={styles.cellText}>{row.name}</td>
                      <td className={styles.cellText}>{row.unit || '—'}</td>
                      <td className={styles.cellText}>{row.packSize ?? '—'}</td>
                      <td className={styles.cellText}>{row.costPrice != null ? row.costPrice.toFixed(2) : '—'}</td>
                      <td className={styles.cellText}>{row.supplierName || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {csvRows.length > 20 && (
              <p className={styles.dropZoneHint} style={{ marginTop: 8 }}>
                Showing first 20 of {csvRows.length} rows.
              </p>
            )}
            <div className={styles.csvActions}>
              <button
                type="button"
                className={styles.csvCancel}
                onClick={() => {
                  setCsvRows(null)
                  setCsvFileName(null)
                }}
                disabled={importing}
              >
                Cancel
              </button>
              <button type="button" className={styles.csvConfirm} onClick={confirmImport} disabled={importing}>
                {importing ? 'Importing…' : `Import ${csvRows.length} product${csvRows.length !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className={styles.toolbar}>
        <input
          className={styles.search}
          placeholder="Search by name, category, unit, or supplier"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button type="button" className={styles.exportButton} onClick={handleExportCsv}>
          Export CSV
        </button>
        <button type="button" className={styles.addButton} onClick={handleAddProduct}>
          + Add product
        </button>
      </div>

      {loading ? (
        <p className={styles.loading}>Loading products…</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                {COLUMNS.map((col) => (
                  <th key={col.field} onClick={() => toggleSort(col.field)}>
                    {col.label}
                    {sortField === col.field ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                  </th>
                ))}
                <th onClick={() => toggleSort('status')}>
                  Status{sortField === 'status' ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                </th>
                <th style={{ width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((product) => (
                <Fragment key={product.id}>
                  <tr>
                    {COLUMNS.map((col) => (
                      <td key={col.field}>{renderCell(product, col.field)}</td>
                    ))}
                    <td className={styles.statusCell}>
                      <span
                        className={`${styles.statusBadge} ${
                          isIncomplete(product) ? styles.statusIncomplete : styles.statusComplete
                        }`}
                      >
                        {isIncomplete(product) ? 'Incomplete' : 'Complete'}
                      </span>
                    </td>
                    <td className={styles.deleteCell}>
                      <button
                        type="button"
                        className={styles.deleteBtn}
                        onClick={() => setConfirmDeleteId(confirmDeleteId === product.id ? null : product.id)}
                        title="Delete product"
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                  {confirmDeleteId === product.id && (
                    <tr className={styles.deleteConfirmRow}>
                      <td colSpan={COLUMNS.length + 2} className={styles.deleteConfirmCell}>
                        <span className={styles.deleteConfirmText}>
                          Delete <strong>{product.name || 'this product'}</strong> permanently?
                        </span>
                        <button
                          type="button"
                          className={styles.deleteConfirmYes}
                          onClick={() => handleDeleteProduct(product.id)}
                        >
                          Delete
                        </button>
                        <button
                          type="button"
                          className={styles.deleteConfirmNo}
                          onClick={() => setConfirmDeleteId(null)}
                        >
                          Cancel
                        </button>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
          {visibleRows.length === 0 && (
            <p className={styles.empty}>
              {search.trim() ? 'No products match your search.' : 'No products yet — add one above.'}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
