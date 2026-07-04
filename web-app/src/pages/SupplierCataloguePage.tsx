import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { User } from 'firebase/auth'
import {
  addDoc, collection, deleteDoc, doc,
  onSnapshot, orderBy, query, serverTimestamp,
  updateDoc, writeBatch,
} from 'firebase/firestore'
import { db } from '../firebase'
import styles from './SupplierCataloguePage.module.css'

// ─── Types ────────────────────────────────────────────────────────────────────

type CatalogueProduct = {
  id: string
  name: string
  sku: string | null
  category: string | null
  unit: string | null
  packSize: number | null
  standardPrice: number | null
  available: boolean
  updatedAt: Date | null
}

type EditableField = 'name' | 'sku' | 'category' | 'unit' | 'packSize' | 'standardPrice'

const COLUMNS: { field: EditableField; label: string }[] = [
  { field: 'name',          label: 'Name' },
  { field: 'sku',           label: 'SKU' },
  { field: 'category',      label: 'Category' },
  { field: 'unit',          label: 'Unit' },
  { field: 'packSize',      label: 'Pack Size' },
  { field: 'standardPrice', label: 'Price' },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function displayValue(p: CatalogueProduct, field: EditableField): string {
  switch (field) {
    case 'name':          return p.name || ''
    case 'sku':           return p.sku || ''
    case 'category':      return p.category || ''
    case 'unit':          return p.unit || ''
    case 'packSize':      return p.packSize != null ? String(p.packSize) : ''
    case 'standardPrice': return p.standardPrice != null ? p.standardPrice.toFixed(2) : ''
  }
}

function buildPayload(field: EditableField, raw: string): Record<string, unknown> {
  const t = raw.trim()
  switch (field) {
    case 'name':          return { name: t, updatedAt: serverTimestamp() }
    case 'sku':           return { sku: t || null, updatedAt: serverTimestamp() }
    case 'category':      return { category: t || null, updatedAt: serverTimestamp() }
    case 'unit':          return { unit: t || null, updatedAt: serverTimestamp() }
    case 'packSize': {
      const n = t === '' ? null : Math.round(Number(t))
      return { packSize: n != null && Number.isFinite(n) ? n : null, updatedAt: serverTimestamp() }
    }
    case 'standardPrice': {
      const n = t === '' ? null : Number(t)
      return { standardPrice: n != null && Number.isFinite(n) && n >= 0 ? n : null, updatedAt: serverTimestamp() }
    }
  }
}

function getAdjacent(rows: CatalogueProduct[], id: string, field: EditableField, dir: 1 | -1): { id: string; field: EditableField } | null {
  const ri = rows.findIndex(r => r.id === id)
  if (ri === -1) return null
  const ci = COLUMNS.findIndex(c => c.field === field)
  let nc = ci + dir, nr = ri
  if (nc >= COLUMNS.length) { nc = 0; nr++ }
  else if (nc < 0) { nc = COLUMNS.length - 1; nr-- }
  if (nr < 0 || nr >= rows.length) return null
  return { id: rows[nr].id, field: COLUMNS[nc].field }
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], field = '', inQ = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++ } else inQ = false }
      else field += ch
    } else if (ch === '"') inQ = true
    else if (ch === ',') { row.push(field); field = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field); field = ''; rows.push(row); row = []
    } else field += ch
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  return rows.filter(r => !(r.length === 1 && r[0].trim() === ''))
}

function fmtDate(d: Date | null): string {
  if (!d) return '—'
  return d.toLocaleDateString('en-NZ', { day: '2-digit', month: 'short' })
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function SupplierCataloguePage({ supplierId, user: _user }: { supplierId: string; user: User }) {
  const [products, setProducts] = useState<CatalogueProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [editingCell, setEditingCell] = useState<{ id: string; field: EditableField } | null>(null)
  const [editValue, setEditValue] = useState('')
  const skipNextBlur = useRef(false)
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [showCsvImport, setShowCsvImport] = useState(false)
  const [csvPreviewRows, setCsvPreviewRows] = useState<CatalogueProduct[] | null>(null)
  const [csvError, setCsvError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [pinnedNewId, setPinnedNewId] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    const unsub = onSnapshot(
      query(collection(db, 'supplierAccounts', supplierId, 'catalogue'), orderBy('name', 'asc')),
      (snap) => {
        setProducts(snap.docs.map(d => {
          const data = d.data() as any
          return {
            id: d.id,
            name: data.name || '',
            sku: data.sku ?? null,
            category: data.category ?? null,
            unit: data.unit ?? null,
            packSize: data.packSize ?? null,
            standardPrice: data.standardPrice ?? null,
            available: data.available !== false,
            updatedAt: data.updatedAt?.toDate?.() ?? null,
          }
        }))
        setLoading(false)
      },
      () => setLoading(false)
    )
    return unsub
  }, [supplierId])

  useEffect(() => {
    if (!editingCell) return
    inputRefs.current[`${editingCell.id}:${editingCell.field}`]?.focus()
  }, [editingCell, products])

  useEffect(() => {
    if (pinnedNewId && editingCell && editingCell.id !== pinnedNewId) setPinnedNewId(null)
  }, [editingCell, pinnedNewId])

  const visibleRows = useMemo(() => {
    const needle = search.trim().toLowerCase()
    let rows = products
    if (needle) rows = rows.filter(p =>
      p.name.toLowerCase().includes(needle) ||
      (p.sku || '').toLowerCase().includes(needle) ||
      (p.category || '').toLowerCase().includes(needle)
    )
    if (pinnedNewId) {
      const idx = rows.findIndex(p => p.id === pinnedNewId)
      if (idx > 0) { const copy = [...rows]; const [r] = copy.splice(idx, 1); return [r, ...copy] }
    }
    return rows
  }, [products, search, pinnedNewId])

  async function commitEdit(id: string, field: EditableField, raw: string) {
    try {
      await updateDoc(doc(db, 'supplierAccounts', supplierId, 'catalogue', id), buildPayload(field, raw))
    } catch (e) { console.error('[Catalogue] save failed', e) }
  }

  function startEdit(product: CatalogueProduct, field: EditableField) {
    setEditingCell({ id: product.id, field })
    setEditValue(displayValue(product, field))
  }

  function handleBlur() {
    if (skipNextBlur.current) { skipNextBlur.current = false; return }
    if (editingCell) commitEdit(editingCell.id, editingCell.field, editValue)
    setEditingCell(null)
  }

  function handleCellKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!editingCell) return
    if (e.key === 'Enter') {
      e.preventDefault(); skipNextBlur.current = true
      commitEdit(editingCell.id, editingCell.field, editValue); setEditingCell(null)
    } else if (e.key === 'Escape') {
      e.preventDefault(); skipNextBlur.current = true; setEditingCell(null)
    } else if (e.key === 'Tab') {
      e.preventDefault(); skipNextBlur.current = true
      commitEdit(editingCell.id, editingCell.field, editValue)
      const next = getAdjacent(visibleRows, editingCell.id, editingCell.field, e.shiftKey ? -1 : 1)
      if (next) {
        const nextProd = visibleRows.find(p => p.id === next.id)!
        setEditingCell(next); setEditValue(displayValue(nextProd, next.field))
      } else setEditingCell(null)
    }
  }

  async function handleAddProduct() {
    const ref = doc(collection(db, 'supplierAccounts', supplierId, 'catalogue'))
    setPinnedNewId(ref.id)
    setEditingCell({ id: ref.id, field: 'name' }); setEditValue('')
    await addDoc(collection(db, 'supplierAccounts', supplierId, 'catalogue'), {
      name: '', sku: null, category: null, unit: null,
      packSize: null, standardPrice: null, available: true,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    })
  }

  async function toggleAvailable(product: CatalogueProduct) {
    await updateDoc(doc(db, 'supplierAccounts', supplierId, 'catalogue', product.id), {
      available: !product.available, updatedAt: serverTimestamp(),
    })
  }

  async function handleDeleteProduct(id: string) {
    await deleteDoc(doc(db, 'supplierAccounts', supplierId, 'catalogue', id))
    setConfirmDeleteId(null)
    setSelectedIds(prev => { const n = new Set(prev); n.delete(id); return n })
  }

  async function handleBulkDelete() {
    const ids = [...selectedIds]
    for (let i = 0; i < ids.length; i += 499) {
      const batch = writeBatch(db)
      ids.slice(i, i + 499).forEach(id => batch.delete(doc(db, 'supplierAccounts', supplierId, 'catalogue', id)))
      await batch.commit()
    }
    setSelectedIds(new Set()); setConfirmBulkDelete(false)
  }

  async function handleBulkAvailable(available: boolean) {
    const ids = [...selectedIds]
    for (let i = 0; i < ids.length; i += 499) {
      const batch = writeBatch(db)
      ids.slice(i, i + 499).forEach(id =>
        batch.update(doc(db, 'supplierAccounts', supplierId, 'catalogue', id), { available, updatedAt: serverTimestamp() })
      )
      await batch.commit()
    }
    setSelectedIds(new Set())
  }

  function exportCsv() {
    let csv = 'Name,SKU,Category,Unit,Pack Size,Price,Available\n'
    visibleRows.forEach(p => {
      csv += [p.name, p.sku || '', p.category || '', p.unit || '',
        p.packSize ?? '', p.standardPrice != null ? p.standardPrice.toFixed(2) : '',
        p.available ? 'Yes' : 'No']
        .map(v => `"${String(v).replace(/"/g, '""')}"`).join(',') + '\n'
    })
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'catalogue.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  function handleCsvFiles(files: FileList | null) {
    const file = files?.[0]; if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result || '')
      const rows = parseCsv(text)
      if (rows.length < 2) { setCsvError('No data rows found.'); return }
      const header = rows[0].map(h => h.trim().toLowerCase())
      const nameIdx = header.indexOf('name')
      if (nameIdx === -1) { setCsvError('CSV must have a "Name" column.'); return }
      const skuIdx = header.indexOf('sku')
      const catIdx = header.indexOf('category')
      const unitIdx = header.indexOf('unit')
      const packIdx = header.findIndex(h => h === 'pack size' || h === 'packsize')
      const priceIdx = header.findIndex(h => h === 'price' || h === 'standard price' || h === 'standardprice')
      const parsed: CatalogueProduct[] = rows.slice(1).map((r, i) => ({
        id: `csv_${i}`,
        name: r[nameIdx]?.trim() || '',
        sku: skuIdx >= 0 ? r[skuIdx]?.trim() || null : null,
        category: catIdx >= 0 ? r[catIdx]?.trim() || null : null,
        unit: unitIdx >= 0 ? r[unitIdx]?.trim() || null : null,
        packSize: packIdx >= 0 && r[packIdx]?.trim() ? Math.round(Number(r[packIdx])) : null,
        standardPrice: priceIdx >= 0 && r[priceIdx]?.trim() ? Number(r[priceIdx]) : null,
        available: true, updatedAt: null,
      })).filter(r => r.name)
      if (!parsed.length) { setCsvError('No valid rows found — each row needs a Name.'); return }
      setCsvPreviewRows(parsed); setCsvError(null)
    }
    reader.onerror = () => setCsvError('Could not read file.')
    reader.readAsText(file)
  }

  async function confirmCsvImport() {
    if (!csvPreviewRows?.length) return
    setImporting(true)
    try {
      for (let i = 0; i < csvPreviewRows.length; i += 499) {
        const batch = writeBatch(db)
        csvPreviewRows.slice(i, i + 499).forEach(row => {
          const ref = doc(collection(db, 'supplierAccounts', supplierId, 'catalogue'))
          batch.set(ref, {
            name: row.name, sku: row.sku, category: row.category, unit: row.unit,
            packSize: row.packSize, standardPrice: row.standardPrice, available: true,
            createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
          })
        })
        await batch.commit()
      }
      setCsvPreviewRows(null); setShowCsvImport(false)
    } catch (e: any) { setCsvError(e?.message || 'Import failed.') }
    setImporting(false)
  }

  function renderCell(product: CatalogueProduct, field: EditableField) {
    const isEditing = editingCell?.id === product.id && editingCell.field === field
    if (isEditing) {
      return (
        <input
          ref={el => { inputRefs.current[`${product.id}:${field}`] = el }}
          className={styles.cellInput}
          type={field === 'packSize' || field === 'standardPrice' ? 'number' : 'text'}
          value={editValue}
          onChange={e => setEditValue(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={handleCellKeyDown}
        />
      )
    }
    const value = displayValue(product, field)
    const display = field === 'standardPrice' && value ? `$${value}` : (value || '—')
    return (
      <div
        className={`${styles.cellText} ${!value ? styles.cellTextEmpty : ''} ${!product.available ? styles.cellUnavailable : ''}`}
        onClick={() => startEdit(product, field)}
      >
        {display}
      </div>
    )
  }

  return (
    <div>
      <h1 className={styles.heading}>Catalogue</h1>
      <p className={styles.subhead}>Manage your products and pricing. Connected venues see your current prices automatically.</p>

      {selectedIds.size > 0 && (
        <div className={styles.bulkBar}>
          <span>{selectedIds.size} selected</span>
          <button type="button" className={styles.bulkBtn} onClick={() => handleBulkAvailable(true)}>Mark available</button>
          <button type="button" className={styles.bulkBtn} onClick={() => handleBulkAvailable(false)}>Mark unavailable</button>
          {confirmBulkDelete ? (
            <>
              <span className={styles.bulkConfirm}>Delete {selectedIds.size} products?</span>
              <button type="button" className={styles.bulkDeleteConfirm} onClick={handleBulkDelete}>Confirm</button>
              <button type="button" className={styles.bulkCancel} onClick={() => setConfirmBulkDelete(false)}>Cancel</button>
            </>
          ) : (
            <button type="button" className={styles.bulkDeleteBtn} onClick={() => setConfirmBulkDelete(true)}>Delete selected</button>
          )}
          <button type="button" className={styles.bulkCancel} onClick={() => setSelectedIds(new Set())}>Clear</button>
        </div>
      )}

      <div className={styles.toolbar}>
        <input className={styles.search} placeholder="Search by name, SKU, or category" value={search} onChange={e => setSearch(e.target.value)} />
        <button type="button" className={styles.exportBtn} onClick={exportCsv}>Export CSV</button>
        <button type="button" className={styles.importBtn} onClick={() => { setShowCsvImport(v => !v); setCsvPreviewRows(null); setCsvError(null) }}>Import CSV</button>
        <button type="button" className={styles.addButton} onClick={handleAddProduct}>+ Add product</button>
      </div>

      {showCsvImport && (
        <div className={styles.csvZone}>
          <div
            className={`${styles.dropZone} ${dragActive ? styles.dropZoneActive : ''}`}
            onDragOver={e => { e.preventDefault(); setDragActive(true) }}
            onDragLeave={() => setDragActive(false)}
            onDrop={e => { e.preventDefault(); setDragActive(false); handleCsvFiles(e.dataTransfer.files) }}
            onClick={() => fileInputRef.current?.click()}
          >
            <input ref={fileInputRef} type="file" accept=".csv" hidden onChange={e => handleCsvFiles(e.target.files)} />
            <p className={styles.dropZoneTitle}>Drag a CSV here or click to upload</p>
            <p className={styles.dropZoneHint}>Columns: Name (required), SKU, Category, Unit, Pack Size, Price</p>
          </div>
          {csvError && <p className={styles.csvError}>{csvError}</p>}
          {csvPreviewRows && (
            <div className={styles.csvPreview}>
              <p className={styles.csvPreviewTitle}>{csvPreviewRows.length} product{csvPreviewRows.length !== 1 ? 's' : ''} ready to import</p>
              <div className={styles.actions}>
                <button type="button" className={styles.csvCancel} onClick={() => { setCsvPreviewRows(null); setShowCsvImport(false) }} disabled={importing}>Cancel</button>
                <button type="button" className={styles.csvConfirm} onClick={confirmCsvImport} disabled={importing}>
                  {importing ? 'Importing…' : `Import ${csvPreviewRows.length} products`}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {loading ? (
        <p className={styles.loading}>Loading catalogue…</p>
      ) : products.length === 0 ? (
        <div className={styles.empty}>
          <p>Your catalogue is empty.</p>
          <p style={{ fontSize: 13, color: '#9ca3af', marginTop: 4, fontWeight: 400 }}>Add products individually or import a CSV to get started.</p>
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th style={{ width: 36 }}>
                  <input type="checkbox"
                    checked={selectedIds.size === visibleRows.length && visibleRows.length > 0}
                    onChange={e => setSelectedIds(e.target.checked ? new Set(visibleRows.map(p => p.id)) : new Set())}
                  />
                </th>
                {COLUMNS.map(col => <th key={col.field}>{col.label}</th>)}
                <th>Available</th>
                <th>Updated</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map(product => (
                <Fragment key={product.id}>
                  <tr className={!product.available ? styles.unavailableRow : ''}>
                    <td style={{ padding: '0 6px' }}>
                      <input type="checkbox" checked={selectedIds.has(product.id)}
                        onChange={e => {
                          const n = new Set(selectedIds)
                          if (e.target.checked) n.add(product.id); else n.delete(product.id)
                          setSelectedIds(n)
                        }}
                      />
                    </td>
                    {COLUMNS.map(col => <td key={col.field}>{renderCell(product, col.field)}</td>)}
                    <td style={{ padding: '6px 10px' }}>
                      <button
                        type="button"
                        className={`${styles.availableToggle} ${product.available ? styles.availableOn : styles.availableOff}`}
                        onClick={() => toggleAvailable(product)}
                      >
                        {product.available ? '● Available' : '● Unavailable'}
                      </button>
                    </td>
                    <td className={styles.readonlyCell}>{fmtDate(product.updatedAt)}</td>
                    <td className={styles.actionCell}>
                      {confirmDeleteId !== product.id ? (
                        <button type="button" className={styles.deleteTrigger} onClick={() => setConfirmDeleteId(product.id)}>🗑</button>
                      ) : (
                        <div className={styles.deleteConfirmRow}>
                          <span className={styles.deleteConfirmText}>Remove {product.name || 'this'}?</span>
                          <button type="button" className={styles.deleteConfirmButton} style={{ background: '#dc2626' }} onClick={() => handleDeleteProduct(product.id)}>Delete</button>
                          <button type="button" className={styles.deleteCancelButton} onClick={() => setConfirmDeleteId(null)}>Cancel</button>
                        </div>
                      )}
                    </td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
          {visibleRows.length === 0 && search.trim() && (
            <p className={styles.emptySearch}>No products match your search.</p>
          )}
        </div>
      )}
    </div>
  )
}
