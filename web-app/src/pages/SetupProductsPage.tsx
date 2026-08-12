import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  arrayUnion,
  addDoc,
} from 'firebase/firestore'
import { auth, db } from '../firebase'
import styles from './SetupProductsPage.module.css'
import { listProductSuppliers, upsertProductSupplier, setPreferredProductSupplier, removeProductSupplier } from '../services/productSuppliers'
import type { ProductSupplierLink } from '../services/productSuppliers'
import { searchGlobalCatalogFuzzy } from '../services/globalCatalog'
import type { CatalogHit } from '../services/globalCatalog'
import { mergeProducts } from '../services/mergeProducts'
import type { MergeProductsResult } from '../services/mergeProducts'

type Product = {
  id: string
  name: string
  category: string | null
  unit: string | null
  size: string | null        // physical size string e.g. '700ml', '20L' — used by recipe costing
  packSize: number | null
  costPrice: number | null
  supplierName: string | null
  parLevel: number | null
  gstPercent: number | null
  costPriceSource: string | null
  costPriceEstimatedAt: any
  active?: boolean           // false when merged away; undefined/true means active
  linkedRecipeId: string | null
  linkedRecipeName: string | null
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

type VenueSupplier = { id: string; name: string }

type CatalogueMatch = {
  product: Product
  hit: CatalogHit & { score: number }
  proposedCostPrice: number
  proposedGstPercent: number
}

type EditableField = 'name' | 'category' | 'unit' | 'size' | 'packSize' | 'costPrice' | 'supplierName' | 'parLevel' | 'gstPercent'

// Fixed unit categories — must stay in sync with UNIT_CATEGORIES in
// StockTakeAreaInventoryScreen.tsx (mobile).
const UNIT_CATEGORIES = ['Each', 'Bottle', 'Keg', 'Container', 'Kitchen Liquid', 'Can', 'Jar', 'Sachet', 'Dry/Bag']

// Size presets keyed by unit category — must stay in sync with SIZE_PRESETS_BY_UNIT in
// StockTakeAreaInventoryScreen.tsx (mobile).
// "Unsure" is represented as the empty-string select option (committed as null via buildUpdatePayload).
// 'Each' maps to [] intentionally — individually-counted items have no meaningful size; the
// Size dropdown correctly shows only "Unsure" for this unit.
const SIZE_PRESETS_BY_UNIT: Record<string, string[]> = {
  'Each':           [],
  'Bottle':         ['50ml','100ml','200ml','375ml','500ml','700ml','750ml','1L','1.125L','1.5L','1.75L','2L','3L'],
  'Keg':            ['20L','30L','50L'],
  'Container':      ['5L','10L','20L','30L'],
  'Kitchen Liquid': ['250ml','500ml','1L','2L','4L','20L'],
  'Can':            ['330ml','355ml','375ml','440ml','500ml','400g','800g','2.5kg','3kg'],
  'Jar':            ['180g','250g','300g','510g'],
  'Sachet':         ['2g','3g','3.5g','5g','7g','10g','15ml'],
  'Dry/Bag':        ['100g','250g','500g','1kg','2kg','5kg','10kg','20kg'],
}
// Fallback list — all presets across all categories, deduplicated.  Used when unit is unset
// or doesn't match a known category (grandfathered old data).
const ALL_SIZE_PRESETS = [...new Set(Object.values(SIZE_PRESETS_BY_UNIT).flat())]

const COLUMNS: { field: EditableField; label: string }[] = [
  { field: 'name',         label: 'Name' },
  { field: 'category',     label: 'Category' },
  { field: 'unit',         label: 'Unit' },
  { field: 'size',         label: 'Size' },
  { field: 'packSize',     label: 'Pack Size' },
  { field: 'costPrice',    label: 'Cost Price' },
  { field: 'supplierName', label: 'Supplier' },
  { field: 'parLevel',     label: 'PAR' },
  { field: 'gstPercent',   label: 'GST%' },
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

      if (exactMatch || subMatch) {
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
    case 'size':         return p.size ?? ''
    case 'packSize':     return p.packSize != null ? String(p.packSize) : ''
    case 'costPrice':    return p.costPrice != null ? p.costPrice.toFixed(2) : ''
    case 'supplierName': return p.supplierName && p.supplierName !== 'Unassigned' ? p.supplierName : ''
    case 'parLevel':     return p.parLevel != null ? String(p.parLevel) : ''
    case 'gstPercent':   return p.gstPercent != null ? String(p.gstPercent) : ''
  }
}

function buildUpdatePayload(field: EditableField, raw: string): Record<string, unknown> {
  const trimmed = raw.trim()
  switch (field) {
    case 'name':
      return { name: trimmed, updatedAt: serverTimestamp() }
    case 'unit':
      return { unit: trimmed || null, updatedAt: serverTimestamp() }
    case 'size':
      // Physical size string e.g. "700ml", "20L" — used by recipe costing.
      // Store null (not empty string) when cleared so computeIngredientCost
      // treats it as "no size info" rather than an unparseable value.
      return { size: trimmed || null, updatedAt: serverTimestamp() }
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
    case 'gstPercent': {
      const n = trimmed === '' ? null : Number(trimmed)
      return { gstPercent: n != null && Number.isFinite(n) ? n : null, updatedAt: serverTimestamp() }
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
  size: string
  packSize: number | null
  costPrice: number | null
  supplierName: string
}

function mapCsvRows(rows: string[][]): { parsed: CsvRow[]; error: string | null } {
  if (rows.length === 0) return { parsed: [], error: 'The file is empty.' }
  const header = rows[0].map((h) => h.trim().toLowerCase())
  const nameIdx = header.findIndex((h) => h === 'name')
  const unitIdx = header.findIndex((h) => h === 'unit')
  const sizeIdx = header.findIndex((h) => h === 'size')
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
      size: sizeIdx >= 0 ? (r[sizeIdx] || '').trim() : '',
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

const DEFAULT_CATEGORIES = ['beer', 'wine', 'spirits', 'rtd', 'na']

function LearnableSelect({
  options, currentValue, onCommit, onAddOption, onCancel,
}: {
  options: string[]
  currentValue: string
  onCommit: (value: string) => void
  onAddOption: (value: string) => void
  onCancel: () => void
}) {
  const [addingNew, setAddingNew] = useState(false)
  const [newValue, setNewValue] = useState('')
  const committedRef = useRef(false)
  const newInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (addingNew) {
      committedRef.current = false
      newInputRef.current?.focus()
    }
  }, [addingNew])

  const allOptions = currentValue && !options.some(o => o.toLowerCase() === currentValue.toLowerCase())
    ? [currentValue, ...options]
    : options

  function handleSelectChange(e: React.ChangeEvent<HTMLSelectElement>) {
    committedRef.current = true
    if (e.target.value === '__add_new__') {
      setAddingNew(true)
    } else {
      onCommit(e.target.value)
    }
  }

  function commitNew() {
    if (committedRef.current) return
    const val = newValue.trim()
    if (val) { committedRef.current = true; onAddOption(val); onCommit(val) }
    else { onCancel() }
  }

  if (addingNew) {
    return (
      <input
        ref={newInputRef}
        className={styles.cellInput}
        type="text"
        value={newValue}
        placeholder="Type new option…"
        onChange={e => setNewValue(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); commitNew() }
          else if (e.key === 'Escape') { e.preventDefault(); onCancel() }
        }}
        onBlur={commitNew}
      />
    )
  }

  return (
    <select
      className={styles.cellInput}
      value={currentValue || ''}
      onChange={handleSelectChange}
      onBlur={() => { if (!committedRef.current) onCancel() }}
      autoFocus
    >
      {allOptions.map(o => <option key={o} value={o}>{o}</option>)}
      <option value="__add_new__">+ Add new…</option>
    </select>
  )
}

function SupplierSelect({
  suppliers, currentValue, onCommit, onQuickAdd, onCancel, onManage,
}: {
  suppliers: VenueSupplier[]
  currentValue: string
  onCommit: (supplier: VenueSupplier) => void
  onQuickAdd: (name: string) => Promise<VenueSupplier | null>
  onCancel: () => void
  onManage: () => void
}) {
  const [addingNew, setAddingNew] = useState(false)
  const [newValue, setNewValue] = useState('')
  const committedRef = useRef(false)
  const newInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (addingNew) {
      committedRef.current = false
      newInputRef.current?.focus()
    }
  }, [addingNew])

  const matchedSupplier = suppliers.find(
    s => s.name.toLowerCase() === currentValue.toLowerCase()
  )
  const selectedId = matchedSupplier?.id || ''

  function handleSelectChange(e: React.ChangeEvent<HTMLSelectElement>) {
    committedRef.current = true
    const val = e.target.value
    if (val === '__add_new__') {
      setAddingNew(true)
    } else if (val === '__manage__') {
      onManage()
    } else {
      const selected = suppliers.find(s => s.id === val)
      if (selected) onCommit(selected)
      else onCancel()
    }
  }

  async function commitNew() {
    if (committedRef.current) return
    const val = newValue.trim()
    if (!val) { onCancel(); return }
    committedRef.current = true
    const supplier = await onQuickAdd(val)
    if (supplier) onCommit(supplier)
    else onCancel()
  }

  if (addingNew) {
    return (
      <input
        ref={newInputRef}
        className={styles.cellInput}
        type="text"
        value={newValue}
        placeholder="Supplier name…"
        onChange={e => setNewValue(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); commitNew() }
          else if (e.key === 'Escape') { e.preventDefault(); onCancel() }
        }}
        onBlur={commitNew}
      />
    )
  }

  return (
    <select
      className={styles.cellInput}
      value={selectedId}
      onChange={handleSelectChange}
      onBlur={() => { if (!committedRef.current) onCancel() }}
      autoFocus
    >
      <option value="">— Select supplier —</option>
      {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
      <option value="__add_new__">+ Add new supplier…</option>
      <option value="__manage__">Manage suppliers…</option>
    </select>
  )
}

function SupplierManageModal({
  venueId, productId, productName, suppliers, onClose,
}: {
  venueId: string
  productId: string
  productName: string
  suppliers: VenueSupplier[]
  onClose: () => void
}) {
  const [links, setLinks] = useState<ProductSupplierLink[]>([])
  const [loading, setLoading] = useState(true)
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null)
  const [addingSupplierId, setAddingSupplierId] = useState('')
  const [working, setWorking] = useState(false)

  async function refreshLinks() {
    try {
      const fetched = await listProductSuppliers(venueId, productId)
      setLinks(fetched.sort((a, b) => (b.isPreferred ? 1 : 0) - (a.isPreferred ? 1 : 0)))
    } catch {}
  }

  useEffect(() => {
    let alive = true
    setLoading(true)
    listProductSuppliers(venueId, productId)
      .then(fetched => {
        if (!alive) return
        setLinks(fetched.sort((a, b) => (b.isPreferred ? 1 : 0) - (a.isPreferred ? 1 : 0)))
      })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [venueId, productId])

  async function handleSetPreferred(supplierId: string) {
    setWorking(true)
    try { await setPreferredProductSupplier(venueId, productId, supplierId); await refreshLinks() } catch {}
    setWorking(false)
  }

  async function handleRelationshipChange(supplierId: string, relationship: string) {
    setWorking(true)
    try { await upsertProductSupplier(venueId, productId, supplierId, { relationship: relationship as any }); await refreshLinks() } catch {}
    setWorking(false)
  }

  async function handleRemove(supplierId: string) {
    setWorking(true)
    try { await removeProductSupplier(venueId, productId, supplierId); setConfirmRemoveId(null); await refreshLinks() } catch {}
    setWorking(false)
  }

  async function handleAddLink() {
    const sup = suppliers.find(s => s.id === addingSupplierId)
    if (!sup) return
    setWorking(true)
    try {
      await upsertProductSupplier(venueId, productId, sup.id, {
        supplierName: sup.name, isPreferred: false, relationship: 'alternative', unitCost: null,
      })
      setAddingSupplierId('')
      await refreshLinks()
    } catch {}
    setWorking(false)
  }

  function relColour(r: string | undefined) {
    switch (r) {
      case 'contracted': return '#1b4f72'
      case 'preferred': return '#065f46'
      case 'emergency': return '#b91c1c'
      default: return '#64748b'
    }
  }

  const linkedIds = new Set(links.map(l => l.supplierId))
  const availableToAdd = suppliers.filter(s => !linkedIds.has(s.id))

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
      onClick={onClose}
    >
      <div
        style={{ background: '#fff', borderRadius: 14, padding: '24px 28px', minWidth: 420, maxWidth: 560, width: '90vw', maxHeight: '80vh', overflowY: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <h2 style={{ margin: 0, fontFamily: "'Playfair Display', Georgia, serif", fontSize: 20, color: '#0B132B' }}>
            {productName || 'Product'} — Suppliers
          </h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#6B7280', lineHeight: 1 }}>×</button>
        </div>

        {/* Supplier list */}
        {loading ? (
          <p style={{ color: '#6B7280', fontSize: 14 }}>Loading…</p>
        ) : links.length === 0 ? (
          <p style={{ color: '#6B7280', fontSize: 14 }}>No supplier links yet.</p>
        ) : links.map(link => (
          <div key={link.supplierId} style={{ borderBottom: '1px solid #e5e3de', paddingBottom: 14, marginBottom: 14 }}>
            {/* Name + badge */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              {link.isPreferred && <span title="Preferred">⭐</span>}
              <span style={{ fontWeight: 700, color: '#0B132B', flex: 1 }}>{link.supplierName}</span>
              <span style={{ background: relColour(link.relationship), color: '#fff', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, textTransform: 'capitalize' }}>
                {link.relationship || 'alternative'}
              </span>
            </div>
            {/* Cost info */}
            {link.unitCost != null && (
              <p style={{ margin: '2px 0', fontSize: 13, color: '#6B7280' }}>
                ${link.unitCost.toFixed(2)}/unit
                {link.caseSize ? ` · Case of ${link.caseSize} · $${(link.caseCost ?? link.unitCost * link.caseSize).toFixed(2)}/case` : ''}
              </p>
            )}
            {link.lastInvoicePrice != null && (
              <p style={{ margin: '2px 0', fontSize: 12, color: '#6B7280' }}>Last invoice: ${link.lastInvoicePrice.toFixed(2)}</p>
            )}
            {/* Actions or inline confirm-remove */}
            {confirmRemoveId === link.supplierId ? (
              <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 13, color: '#b91c1c' }}>Remove {link.supplierName}?</span>
                <button onClick={() => handleRemove(link.supplierId)} disabled={working} style={{ background: '#b91c1c', color: '#fff', border: 'none', borderRadius: 999, padding: '4px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Remove</button>
                <button onClick={() => setConfirmRemoveId(null)} style={{ background: 'none', border: '1px solid #e5e3de', borderRadius: 999, padding: '4px 12px', fontSize: 12, cursor: 'pointer', color: '#6B7280' }}>Cancel</button>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                {!link.isPreferred && (
                  <button onClick={() => handleSetPreferred(link.supplierId)} disabled={working} style={{ background: '#f0fdf4', border: 'none', borderRadius: 999, padding: '4px 12px', fontSize: 12, fontWeight: 700, color: '#0f766e', cursor: 'pointer' }}>
                    Set preferred
                  </button>
                )}
                <select
                  value={link.relationship || 'alternative'}
                  onChange={e => handleRelationshipChange(link.supplierId, e.target.value)}
                  disabled={working}
                  style={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e3de', padding: '4px 8px', color: '#374151', background: '#f1f5f9' }}
                >
                  <option value="preferred">Preferred — Your go-to supplier</option>
                  <option value="contracted">Contracted — You have a supply agreement</option>
                  <option value="alternative">Alternative — Backup option</option>
                  <option value="emergency">Emergency — Last resort only</option>
                </select>
                <button onClick={() => setConfirmRemoveId(link.supplierId)} disabled={working} style={{ background: '#fef2f2', border: 'none', borderRadius: 999, padding: '4px 12px', fontSize: 12, fontWeight: 700, color: '#b91c1c', cursor: 'pointer' }}>
                  Remove
                </button>
              </div>
            )}
          </div>
        ))}

        {/* Add supplier section */}
        {availableToAdd.length > 0 && (
          <div style={{ borderTop: '1px solid #e5e3de', paddingTop: 16, marginTop: 4 }}>
            <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 700, color: '#0B132B' }}>Add a supplier</p>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <select
                value={addingSupplierId}
                onChange={e => setAddingSupplierId(e.target.value)}
                style={{ flex: 1, fontSize: 13, border: '1px solid #e5e3de', borderRadius: 8, padding: '6px 10px' }}
              >
                <option value="">— Select supplier —</option>
                {availableToAdd.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <button
                onClick={handleAddLink}
                disabled={!addingSupplierId || working}
                style={{ background: '#1b4f72', color: '#fff', border: 'none', borderRadius: 999, padding: '6px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: !addingSupplierId || working ? 0.5 : 1 }}
              >
                Link
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function CatalogueReviewModal({
  matches, venueId, onClose, onApplied,
}: {
  matches: CatalogueMatch[]
  venueId: string
  onClose: () => void
  onApplied: () => void
}) {
  const [accepted, setAccepted] = useState<Set<string>>(
    () => new Set(matches.map(m => m.product.id))
  )
  const [applying, setApplying] = useState(false)

  function toggleAccepted(productId: string) {
    setAccepted(prev => {
      const next = new Set(prev)
      if (next.has(productId)) next.delete(productId)
      else next.add(productId)
      return next
    })
  }

  async function handleApply() {
    const toApply = matches.filter(m => accepted.has(m.product.id))
    if (toApply.length === 0) { onClose(); return }
    setApplying(true)
    try {
      for (let i = 0; i < toApply.length; i += 500) {
        const chunk = toApply.slice(i, i + 500)
        const batch = writeBatch(db)
        for (const m of chunk) {
          const updates: Record<string, any> = {
            costPrice: m.proposedCostPrice,
            costPriceSource: 'catalogue_estimate',
            costPriceEstimatedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          }
          if (m.product.gstPercent == null) updates.gstPercent = m.proposedGstPercent
          batch.update(doc(db, 'venues', venueId, 'products', m.product.id), updates)
        }
        await batch.commit()
      }
      onApplied()
    } catch (e) {
      console.error('[CatalogueReviewModal] apply failed', e)
    }
    setApplying(false)
  }

  const selectedCount = accepted.size

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
      onClick={onClose}
    >
      <div
        style={{ background: '#fff', borderRadius: 14, padding: '24px 28px', minWidth: 480, maxWidth: 640, width: '90vw', maxHeight: '80vh', overflowY: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6 }}>
          <h2 style={{ margin: 0, fontFamily: "'Playfair Display', Georgia, serif", fontSize: 20, color: '#0B132B' }}>
            Catalogue Matches
          </h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#6B7280', lineHeight: 1 }}>×</button>
        </div>
        <p style={{ margin: '0 0 20px', fontSize: 13, color: '#6B7280' }}>
          Found cost price estimates for {matches.length} unpriced product{matches.length !== 1 ? 's' : ''}. Review and apply selected.
        </p>

        {matches.map(m => (
          <div key={m.product.id} style={{ borderBottom: '1px solid #e5e3de', paddingBottom: 14, marginBottom: 14, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <input
              type="checkbox"
              checked={accepted.has(m.product.id)}
              onChange={() => toggleAccepted(m.product.id)}
              style={{ marginTop: 3, flexShrink: 0 }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, color: '#0B132B', fontSize: 14 }}>{m.product.name}</div>
              <div style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}>
                Matched: "{m.hit.name}" from {m.hit.supplierName}
                <span style={{ marginLeft: 8, color: '#9CA3AF' }}>({Math.round(m.hit.score * 100)}% match)</span>
              </div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontWeight: 700, color: '#0B132B', fontSize: 14 }}>${m.proposedCostPrice.toFixed(2)}</div>
              <div style={{ fontSize: 11, color: '#6B7280' }}>GST {m.proposedGstPercent}%</div>
            </div>
          </div>
        ))}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4, paddingTop: 16, borderTop: '1px solid #e5e3de' }}>
          <button
            onClick={onClose}
            disabled={applying}
            style={{ background: 'none', border: '1px solid #e5e3de', borderRadius: 999, padding: '8px 20px', fontSize: 13, color: '#6B7280', cursor: 'pointer' }}
          >
            Cancel
          </button>
          <button
            onClick={handleApply}
            disabled={applying || selectedCount === 0}
            style={{ background: '#1b4f72', color: '#fff', border: 'none', borderRadius: 999, padding: '8px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: selectedCount === 0 || applying ? 0.5 : 1 }}
          >
            {applying ? 'Applying…' : `Apply ${selectedCount} selected`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── MergeModal ─────────────────────────────────────────────────────────────
// Two-step modal: dry-run → impact summary → confirm → real merge.
// source  = the product that becomes inactive (merged away)
// target  = the product that survives (selected by the user in this modal)
function MergeModal({
  venueId,
  source,
  allProducts,
  onClose,
  onMergeComplete,
}: {
  venueId: string
  source: Product
  allProducts: Product[]
  onClose: () => void
  onMergeComplete?: (targetId: string) => void
}) {
  const [mergeQuery, setMergeQuery] = useState('')
  const [target, setTarget] = useState<Product | null>(null)
  const [dryRunResult, setDryRunResult] = useState<MergeProductsResult | null>(null)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  // Local fuzzy search — filter the already-loaded product list rather than
  // making additional Firestore queries, matching the CraftItPage convention.
  const suggestions = useMemo(() => {
    if (target) return []
    const q = mergeQuery.trim().toLowerCase()
    if (!q) return []
    return allProducts
      .filter(p => p.id !== source.id)
      .filter(p => p.name.toLowerCase().includes(q))
      .slice(0, 8)
  }, [mergeQuery, allProducts, source.id, target])

  async function handleSelectTarget(p: Product) {
    setTarget(p)
    setMergeQuery(p.name)
    setDryRunResult(null)
    setError(null)
    setWorking(true)
    try {
      const result = await mergeProducts(venueId, p.id, source.id, true)
      setDryRunResult(result)
    } catch (e: any) {
      setError(String(e?.message || 'Dry run failed.'))
    }
    setWorking(false)
  }

  async function handleConfirmMerge() {
    if (!target) return
    setWorking(true)
    setError(null)
    try {
      await mergeProducts(venueId, target.id, source.id, false)
      onMergeComplete?.(target.id)
      setDone(true)
    } catch (e: any) {
      setError(String(e?.message || 'Merge failed.'))
    }
    setWorking(false)
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
      onClick={done ? onClose : undefined}
    >
      <div
        style={{ background: '#fff', borderRadius: 14, padding: '24px 28px', minWidth: 440, maxWidth: 580, width: '90vw', maxHeight: '80vh', overflowY: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6 }}>
          <h2 style={{ margin: 0, fontFamily: "'Playfair Display', Georgia, serif", fontSize: 20, color: '#0B132B' }}>
            Merge product
          </h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#6B7280', lineHeight: 1 }}>×</button>
        </div>
        <p style={{ margin: '0 0 20px', fontSize: 13, color: '#6B7280' }}>
          <strong style={{ color: '#0B132B' }}>{source.name}</strong> will become inactive and its stocktake area entries will be re-pointed to the product you choose below.
        </p>

        {done ? (
          /* ── Done state ── */
          <>
            <p style={{ color: '#065f46', fontWeight: 700, fontSize: 14, margin: '0 0 6px' }}>✓ Merged successfully</p>
            <p style={{ color: '#6B7280', fontSize: 13, margin: '0 0 20px' }}>
              {source.name} is now inactive. Area entries have been re-pointed to {target?.name}.
            </p>
            <button
              onClick={onClose}
              style={{ background: '#1b4f72', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 20px', fontSize: 14, fontWeight: 700, cursor: 'pointer', width: '100%', fontFamily: 'Inter, system-ui, sans-serif' }}
            >
              Done
            </button>
          </>
        ) : (
          /* ── Search + confirm flow ── */
          <>
            {/* Target search */}
            <div style={{ position: 'relative', marginBottom: 16 }}>
              <p style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Merge {source.name} into…
              </p>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="text"
                  placeholder="Search by product name…"
                  value={mergeQuery}
                  onChange={e => {
                    setMergeQuery(e.target.value)
                    if (target) { setTarget(null); setDryRunResult(null); setError(null) }
                  }}
                  disabled={working}
                  autoFocus
                  style={{ flex: 1, padding: '8px 12px', border: '1.5px solid #e5e3de', borderRadius: 8, fontSize: 13, outline: 'none', fontFamily: 'Inter, system-ui, sans-serif', color: '#0B132B' }}
                />
                {target && (
                  <button
                    type="button"
                    onClick={() => { setTarget(null); setDryRunResult(null); setError(null) }}
                    disabled={working}
                    style={{ background: 'none', border: '1px solid #e5e3de', borderRadius: 6, padding: '6px 10px', fontSize: 12, color: '#6B7280', cursor: 'pointer', flexShrink: 0, fontFamily: 'Inter, system-ui, sans-serif' }}
                  >
                    Change
                  </button>
                )}
              </div>

              {/* Suggestions dropdown */}
              {suggestions.length > 0 && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid #e5e3de', borderRadius: 8, zIndex: 10, maxHeight: 200, overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', marginTop: 2 }}>
                  {suggestions.map(p => (
                    <div
                      key={p.id}
                      onClick={() => handleSelectTarget(p)}
                      style={{ padding: '10px 14px', fontSize: 13, cursor: 'pointer', borderBottom: '1px solid #f1efe9' }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#f9f8f6')}
                      onMouseLeave={e => (e.currentTarget.style.background = '')}
                    >
                      <span style={{ fontWeight: 600, color: '#0B132B' }}>{p.name}</span>
                      {p.unit && <span style={{ marginLeft: 8, fontSize: 11, color: '#9ca3af' }}>{p.unit}</span>}
                      {p.category && <span style={{ marginLeft: 6, fontSize: 11, color: '#9ca3af' }}>· {p.category}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Checking indicator (dry run in flight) */}
            {working && !dryRunResult && (
              <p style={{ color: '#6B7280', fontSize: 13, margin: '0 0 12px' }}>Checking impact…</p>
            )}

            {/* Error */}
            {error && (
              <p style={{ color: '#dc2626', fontSize: 13, margin: '0 0 12px' }}>{error}</p>
            )}

            {/* Dry-run impact summary */}
            {dryRunResult && target && (
              <div style={{ background: '#f9f8f6', borderRadius: 8, padding: '14px 16px', marginBottom: 16, border: '1px solid #e5e3de' }}>
                <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 700, color: '#0B132B' }}>
                  Impact of merging into <em>{target.name}</em>
                </p>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: '#374151', lineHeight: 1.8 }}>
                  <li>{dryRunResult.areaItemsUpdated} stocktake area item{dryRunResult.areaItemsUpdated !== 1 ? 's' : ''} will be re-pointed</li>
                  <li>{dryRunResult.supplierLinksHandled} supplier link{dryRunResult.supplierLinksHandled !== 1 ? 's' : ''} will be migrated</li>
                  <li>{dryRunResult.priceHistoryMoved} price history record{dryRunResult.priceHistoryMoved !== 1 ? 's' : ''} will be moved</li>
                  {dryRunResult.fieldsBackfilled.length > 0 && (
                    <li>Fields to copy onto {target.name} (only where missing): {dryRunResult.fieldsBackfilled.join(', ')}</li>
                  )}
                </ul>
                {dryRunResult.sameAreaConflicts.length > 0 && (
                  <div style={{ marginTop: 10, padding: '10px 12px', background: '#fef3c7', borderRadius: 6, border: '1px solid #fde68a' }}>
                    <p style={{ margin: '0 0 4px', fontSize: 12, fontWeight: 700, color: '#92400e' }}>
                      ⚠ {dryRunResult.sameAreaConflicts.length} same-area conflict{dryRunResult.sameAreaConflicts.length !== 1 ? 's' : ''} — these entries will be skipped
                    </p>
                    <p style={{ margin: '0 0 6px', fontSize: 12, color: '#92400e' }}>
                      Both products already exist in the same stocktake area. Those entries won't be re-pointed — remove one manually first if needed.
                    </p>
                    <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: '#92400e' }}>
                      {dryRunResult.sameAreaConflicts.map(c => (
                        <li key={c.areaItemId}>{c.departmentName} → {c.areaName}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 4 }}>
              <button
                type="button"
                onClick={onClose}
                disabled={working}
                style={{ background: 'none', border: '1px solid #e5e3de', borderRadius: 999, padding: '8px 20px', fontSize: 13, color: '#6B7280', cursor: 'pointer', fontFamily: 'Inter, system-ui, sans-serif' }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmMerge}
                disabled={!target || !dryRunResult || working}
                style={{
                  background: '#1b4f72', color: '#fff', border: 'none', borderRadius: 999,
                  padding: '8px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                  opacity: !target || !dryRunResult || working ? 0.5 : 1,
                  fontFamily: 'Inter, system-ui, sans-serif',
                }}
              >
                {working && dryRunResult ? 'Merging…' : 'Merge'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── RecipeLinkModal ────────────────────────────────────────────────────────────
// Lets the user link a product's cost price to a confirmed recipe's COGS÷servings.
// Only confirmed recipes are shown — drafts cannot be linked.
// Unlinking clears the link fields but leaves costPrice at its current value.
function RecipeLinkModal({
  venueId,
  product,
  onClose,
}: {
  venueId: string
  product: Product
  onClose: () => void
}) {
  type RecipeRow = { id: string; name: string; cogs: number | null; servings: number | null }
  const [recipes, setRecipes] = useState<RecipeRow[]>([])
  const [loadingRecipes, setLoadingRecipes] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [doneMsg, setDoneMsg] = useState('')

  useEffect(() => {
    getDocs(query(collection(db, 'venues', venueId, 'recipes'), where('status', '==', 'confirmed')))
      .then(snap => {
        setRecipes(snap.docs.map(d => {
          const data = d.data() as any
          return { id: d.id, name: data.name || '', cogs: data.cogs ?? null, servings: data.servings ?? null }
        }).sort((a, b) => a.name.localeCompare(b.name)))
        setLoadingRecipes(false)
      })
      .catch(() => setLoadingRecipes(false))
  }, [venueId])

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return recipes
    return recipes.filter(r => r.name.toLowerCase().includes(q))
  }, [searchQuery, recipes])

  async function handleLink(recipe: RecipeRow) {
    setError(null)
    if (!recipe.servings || recipe.servings <= 0) {
      setError('This recipe has no servings set — add one in CraftIt before linking.')
      return
    }
    if (recipe.cogs == null) {
      setError('This recipe has no COGS — add ingredients with cost prices first.')
      return
    }
    setWorking(true)
    try {
      const costPrice = Math.round((recipe.cogs / recipe.servings) * 10000) / 10000
      await updateDoc(doc(db, 'venues', venueId, 'products', product.id), {
        costPrice,
        linkedRecipeId: recipe.id,
        linkedRecipeName: recipe.name,
        updatedAt: serverTimestamp(),
      })
      setDoneMsg(`Linked to "${recipe.name}" — cost price set to $${costPrice.toFixed(4)}`)
      setDone(true)
    } catch {
      setError('Link failed — try again.')
    }
    setWorking(false)
  }

  async function handleUnlink() {
    setWorking(true)
    setError(null)
    try {
      await updateDoc(doc(db, 'venues', venueId, 'products', product.id), {
        linkedRecipeId: null,
        linkedRecipeName: null,
        updatedAt: serverTimestamp(),
      })
      setDoneMsg('Recipe link removed. Cost price is unchanged.')
      setDone(true)
    } catch {
      setError('Unlink failed — try again.')
    }
    setWorking(false)
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
      onClick={done ? onClose : undefined}
    >
      <div
        style={{ background: '#fff', borderRadius: 14, padding: '24px 28px', minWidth: 440, maxWidth: 560, width: '90vw', maxHeight: '80vh', overflowY: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6 }}>
          <h2 style={{ margin: 0, fontFamily: "'Playfair Display', Georgia, serif", fontSize: 20, color: '#0B132B' }}>
            Link recipe
          </h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#6B7280', lineHeight: 1 }}>×</button>
        </div>
        <p style={{ margin: '0 0 16px', fontSize: 13, color: '#6B7280' }}>
          Linking sets <strong style={{ color: '#0B132B' }}>{product.name}</strong>'s cost price to
          the recipe's COGS ÷ servings. Use ↻ Sync to re-apply after the recipe changes.
        </p>

        {done ? (
          <>
            <p style={{ color: '#065f46', fontWeight: 700, fontSize: 14, margin: '0 0 6px' }}>✓ Done</p>
            <p style={{ color: '#6B7280', fontSize: 13, margin: '0 0 20px' }}>{doneMsg}</p>
            <button
              onClick={onClose}
              style={{ background: '#1b4f72', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 20px', fontSize: 14, fontWeight: 700, cursor: 'pointer', width: '100%', fontFamily: 'Inter, system-ui, sans-serif' }}
            >
              Done
            </button>
          </>
        ) : (
          <>
            {/* Current link banner + Unlink */}
            {product.linkedRecipeId && (
              <div style={{ background: '#f0f9ff', borderRadius: 8, padding: '10px 14px', marginBottom: 14, border: '1px solid #bae6fd', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontSize: 13, color: '#0369a1' }}>
                  🔗 Linked to <strong>{product.linkedRecipeName || product.linkedRecipeId}</strong>
                </span>
                <button
                  type="button"
                  onClick={handleUnlink}
                  disabled={working}
                  style={{ background: 'none', border: '1px solid #7dd3fc', borderRadius: 6, padding: '4px 10px', fontSize: 12, color: '#0369a1', cursor: 'pointer', fontFamily: 'Inter, system-ui, sans-serif', flexShrink: 0 }}
                >
                  Unlink
                </button>
              </div>
            )}

            {/* Recipe search */}
            <input
              type="text"
              placeholder="Search confirmed recipes…"
              value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); setError(null) }}
              disabled={working}
              autoFocus
              style={{ width: '100%', boxSizing: 'border-box', padding: '8px 12px', border: '1.5px solid #e5e3de', borderRadius: 8, fontSize: 13, marginBottom: 8, outline: 'none', fontFamily: 'Inter, system-ui, sans-serif', color: '#0B132B' }}
            />

            {error && <p style={{ color: '#dc2626', fontSize: 13, margin: '0 0 10px' }}>{error}</p>}

            {loadingRecipes ? (
              <p style={{ color: '#6B7280', fontSize: 13 }}>Loading recipes…</p>
            ) : filtered.length === 0 ? (
              <p style={{ color: '#6B7280', fontSize: 13 }}>
                {recipes.length === 0
                  ? 'No confirmed recipes — mark a recipe as Confirmed in CraftIt first.'
                  : 'No matching recipes.'}
              </p>
            ) : (
              <div style={{ border: '1px solid #e5e3de', borderRadius: 8, overflow: 'hidden' }}>
                {filtered.slice(0, 12).map((r, i) => (
                  <div
                    key={r.id}
                    onClick={() => !working && handleLink(r)}
                    style={{
                      padding: '10px 14px', fontSize: 13,
                      cursor: working ? 'default' : 'pointer',
                      borderBottom: i < Math.min(filtered.length, 12) - 1 ? '1px solid #f1efe9' : 'none',
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    }}
                    onMouseEnter={e => { if (!working) e.currentTarget.style.background = '#f9f8f6' }}
                    onMouseLeave={e => { e.currentTarget.style.background = '' }}
                  >
                    <span style={{ fontWeight: 600, color: '#0B132B' }}>{r.name}</span>
                    <span style={{ fontSize: 12, color: '#9ca3af', textAlign: 'right' }}>
                      {r.cogs != null ? `$${r.cogs.toFixed(2)} COGS` : 'No COGS'}
                      {r.servings ? ` · ${r.servings} serves` : ' · no servings'}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 16 }}>
              <button
                type="button"
                onClick={onClose}
                disabled={working}
                style={{ background: 'none', border: '1px solid #e5e3de', borderRadius: 999, padding: '8px 20px', fontSize: 13, color: '#6B7280', cursor: 'pointer', fontFamily: 'Inter, system-ui, sans-serif' }}
              >
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default function SetupProductsPage({ venueId }: { venueId: string }) {
  const [venueCategories, setVenueCategories] = useState<string[]>(DEFAULT_CATEGORIES)
  const [venueCountry, setVenueCountry] = useState<string | null>(null)
  const [suppliers, setSuppliers] = useState<VenueSupplier[]>([])
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
  const [linkingProduct, setLinkingProduct] = useState<Product | null>(null)
  const [refreshLinkMsg, setRefreshLinkMsg] = useState<{ id: string; msg: string; ok: boolean } | null>(null)
  const [mergingProduct, setMergingProduct] = useState<Product | null>(null)
  const [mergingCandidateId, setMergingCandidateId] = useState<string | null>(null)
  const [managingSupplierProduct, setManagingSupplierProduct] = useState<{ id: string; name: string } | null>(null)
  const [scanProgress, setScanProgress] = useState<{ current: number; total: number } | null>(null)
  const [catalogueMatches, setCatalogueMatches] = useState<CatalogueMatch[] | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [csvFileName, setCsvFileName] = useState<string | null>(null)
  const [csvRows, setCsvRows] = useState<CsvRow[] | null>(null)
  const [csvError, setCsvError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    getDoc(doc(db, 'venues', venueId)).then((snap) => {
      const data = (snap.exists() ? snap.data() : {}) as any
      setVenueCountry(data.country ?? null)
      setVenueCategories(Array.isArray(data.productCategories) ? data.productCategories : DEFAULT_CATEGORIES)
      const seed: Record<string, unknown> = {}
      if (!('productCategories' in data)) seed.productCategories = DEFAULT_CATEGORIES
      if (Object.keys(seed).length > 0) updateDoc(doc(db, 'venues', venueId), seed).catch(() => {})
    }).catch(() => {})
  }, [venueId])

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'venues', venueId, 'suppliers'),
      (snap) => setSuppliers(snap.docs.map(d => ({ id: d.id, name: (d.data() as any).name || '' }))),
      () => {}
    )
    return unsub
  }, [venueId])

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
              size: data.size ?? null,
              packSize: data.packSize ?? null,
              costPrice: data.costPrice ?? null,
              supplierName: data.supplierName ?? null,
              parLevel: data.parLevel ?? null,
              gstPercent: data.gstPercent ?? null,
              costPriceSource: data.costPriceSource ?? null,
              costPriceEstimatedAt: data.costPriceEstimatedAt ?? null,
              active: data.active,  // false when merged away; undefined/true means active
              linkedRecipeId: data.linkedRecipeId ?? null,
              linkedRecipeName: data.linkedRecipeName ?? null,
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

  async function addVenueOption(value: string) {
    const trimmed = value.trim()
    if (!trimmed) return
    if (venueCategories.some(o => o.toLowerCase() === trimmed.toLowerCase())) return
    try {
      await updateDoc(doc(db, 'venues', venueId), { productCategories: arrayUnion(trimmed) })
      setVenueCategories(prev => [...prev, trimmed])
    } catch (e) {
      console.error('[SetupProductsPage] addVenueOption failed', e)
    }
  }

  async function addSupplier(name: string): Promise<VenueSupplier | null> {
    const trimmed = name.trim()
    if (!trimmed) return null
    const existing = suppliers.find(s => s.name.toLowerCase() === trimmed.toLowerCase())
    if (existing) return existing
    try {
      const ref = await addDoc(collection(db, 'venues', venueId, 'suppliers'), {
        name: trimmed,
        defaultLeadDays: 2,
        createdAt: serverTimestamp(),
      })
      return { id: ref.id, name: trimmed }
    } catch (e) {
      console.error('[SetupProductsPage] addSupplier failed', e)
      return null
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
      gstPercent: venueCountry === 'AU' ? 10 : 15,
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
            size: row.size || null,
            packSize: row.packSize,
            caseSize: row.packSize,
            costPrice: row.costPrice,
            supplierId: null,
            supplierName: row.supplierName || 'Unassigned',
            gstPercent: venueCountry === 'AU' ? 10 : 15,
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
    const headers = ['Name', 'Category', 'Unit', 'Size', 'Pack Size', 'Cost Price', 'Supplier', 'PAR', 'Status']
    const rows = visibleRows.map((p) => [
      p.name,
      p.category || '',
      p.unit || '',
      p.size || '',
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

  async function handleRefreshLinkedCost(product: Product) {
    if (!product.linkedRecipeId) return
    setRefreshLinkMsg(null)
    try {
      const snap = await getDoc(doc(db, 'venues', venueId, 'recipes', product.linkedRecipeId))
      if (!snap.exists()) {
        setRefreshLinkMsg({ id: product.id, msg: 'Recipe not found — it may have been deleted.', ok: false })
        return
      }
      const d = snap.data() as any
      const cogs: number | null = d.cogs ?? null
      const servings: number | null = d.servings ?? null
      if (!servings || servings <= 0) {
        setRefreshLinkMsg({ id: product.id, msg: 'This recipe has no servings set — add one in CraftIt before syncing.', ok: false })
        return
      }
      if (cogs == null) {
        setRefreshLinkMsg({ id: product.id, msg: 'This recipe has no COGS — add ingredients with cost prices first.', ok: false })
        return
      }
      const costPrice = Math.round((cogs / servings) * 10000) / 10000
      await updateDoc(doc(db, 'venues', venueId, 'products', product.id), {
        costPrice,
        updatedAt: serverTimestamp(),
      })
      setRefreshLinkMsg({ id: product.id, msg: `Cost synced to $${costPrice.toFixed(4)} (${cogs.toFixed(2)} ÷ ${servings})`, ok: true })
    } catch {
      setRefreshLinkMsg({ id: product.id, msg: 'Sync failed — try again.', ok: false })
    }
  }

  async function scanForCatalogueMatches() {
    if (scanProgress) return
    const unpriced = products.filter(p => p.costPrice == null)
    if (unpriced.length === 0) return
    setScanProgress({ current: 0, total: unpriced.length })
    const matches: CatalogueMatch[] = []
    for (let i = 0; i < unpriced.length; i++) {
      const product = unpriced[i]
      setScanProgress({ current: i + 1, total: unpriced.length })
      try {
        const hits = await searchGlobalCatalogFuzzy(product.name)
        if (hits.length > 0 && hits[0].priceBottleExGst != null) {
          const best = hits[0]
          matches.push({
            product,
            hit: best,
            proposedCostPrice: best.priceBottleExGst!,
            proposedGstPercent: best.gstPercent ?? (venueCountry === 'AU' ? 10 : 15),
          })
        }
      } catch {
        // non-fatal — skip this product and continue
      }
    }
    setScanProgress(null)
    setCatalogueMatches(matches)
  }

  function renderCell(product: Product, field: EditableField) {
    const isEditing = editingCell?.id === product.id && editingCell.field === field
    if (isEditing) {
      if (field === 'unit') {
        const isUnmatched = editValue !== '' && !UNIT_CATEGORIES.includes(editValue)
        return (
          <select
            autoFocus
            className={styles.cellInput}
            value={editValue}
            onChange={e => {
              commitEdit(product.id, field, e.target.value)
              setEditingCell(null)
            }}
            onBlur={() => setEditingCell(null)}
          >
            <option value="">—</option>
            {isUnmatched && <option key={editValue} value={editValue}>{editValue}</option>}
            {UNIT_CATEGORIES.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
        )
      }
      if (field === 'category') {
        return (
          <LearnableSelect
            options={venueCategories}
            currentValue={displayValue(product, field)}
            onCommit={(val) => { commitEdit(product.id, field, val); setEditingCell(null) }}
            onAddOption={(val) => addVenueOption(val)}
            onCancel={() => setEditingCell(null)}
          />
        )
      }
      if (field === 'supplierName') {
        return (
          <SupplierSelect
            suppliers={suppliers}
            currentValue={displayValue(product, field)}
            onCommit={async (supplier) => {
              try {
                await upsertProductSupplier(venueId, product.id, supplier.id, {
                  supplierName: supplier.name,
                  relationship: 'preferred',
                  unitCost: null,
                })
                await setPreferredProductSupplier(venueId, product.id, supplier.id)
                await updateDoc(doc(db, 'venues', venueId, 'products', product.id), {
                  supplierId: supplier.id,
                  supplierName: supplier.name,
                  updatedAt: serverTimestamp(),
                })
              } catch (e) {
                console.error('[SetupProductsPage] supplier commit failed', e)
              }
              setEditingCell(null)
            }}
            onQuickAdd={addSupplier}
            onCancel={() => setEditingCell(null)}
            onManage={() => {
              setEditingCell(null)
              setManagingSupplierProduct({ id: product.id, name: product.name })
            }}
          />
        )
      }
      if (field === 'size') {
        const sizeList = SIZE_PRESETS_BY_UNIT[product.unit ?? ''] ?? ALL_SIZE_PRESETS
        const isSizeUnmatched = editValue !== '' && !sizeList.includes(editValue)
        return (
          <select
            autoFocus
            className={styles.cellInput}
            value={editValue}
            onChange={e => {
              const val = e.target.value
              commitEdit(product.id, field, val)
              setEditingCell(null)
            }}
            onBlur={() => setEditingCell(null)}
          >
            <option value="">Unsure</option>
            {isSizeUnmatched && <option key={editValue} value={editValue}>{editValue}</option>}
            {sizeList.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        )
      }
      if (field === 'packSize') {
        const PACK_SIZE_PRESETS = [4, 6, 8, 10, 12, 15, 18, 24, 30]
        return (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, padding: '4px 6px 3px' }}>
              {PACK_SIZE_PRESETS.map(n => (
                <button
                  key={n}
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); setEditValue(String(n)) }}
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    padding: '2px 7px',
                    border: '1px solid #e5e3de',
                    borderRadius: 4,
                    background: editValue === String(n) ? '#1b4f72' : '#f9f8f6',
                    color: editValue === String(n) ? '#ffffff' : '#374151',
                    cursor: 'pointer',
                    fontFamily: 'Inter, system-ui, sans-serif',
                    lineHeight: 1.4,
                  }}
                >
                  {n}
                </button>
              ))}
            </div>
            <input
              ref={(el) => { inputRefs.current[`${product.id}:${field}`] = el }}
              className={styles.cellInput}
              type="number"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={handleBlur}
              onKeyDown={handleCellKeyDown}
            />
          </div>
        )
      }
      return (
        <input
          ref={(el) => {
            inputRefs.current[`${product.id}:${field}`] = el
          }}
          className={styles.cellInput}
          type={field === 'costPrice' || field === 'parLevel' ? 'number' : 'text'}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={handleCellKeyDown}
        />
      )
    }
    const value = displayValue(product, field)
    const isEstimate = field === 'costPrice' && product.costPriceSource === 'catalogue_estimate'
    const isLinked  = field === 'costPrice' && !!product.linkedRecipeId
    return (
      <div
        className={`${styles.cellText} ${!value ? styles.cellTextEmpty : ''}`}
        style={isEstimate ? { color: '#c47b2b' } : undefined}
        title={isEstimate ? 'Estimated from catalogue, not yet confirmed by invoice' : isLinked ? `Recipe-derived: ${product.linkedRecipeName}` : undefined}
        onClick={() => startEdit(product, field)}
      >
        {value || '—'}
        {isLinked && (
          <div style={{ fontSize: 10, color: '#0369a1', lineHeight: 1.3, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            🔗 {product.linkedRecipeName}
          </div>
        )}
      </div>
    )
  }

  const incompleteCount = useMemo(() => products.filter(isIncomplete).length, [products])
  const missingCostPrice = useMemo(() => products.filter(p => p.costPrice == null).length, [products])
  const missingSupplier = useMemo(() => products.filter(p => !p.supplierName || p.supplierName === 'Unassigned').length, [products])
  const missingUnit = useMemo(() => products.filter(p => !p.unit).length, [products])

  const staleEstimateCount = useMemo(() => {
    const threeMonthsAgo = new Date()
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3)
    return products.filter(p =>
      p.costPriceSource === 'catalogue_estimate' &&
      p.costPriceEstimatedAt != null &&
      p.costPriceEstimatedAt.toDate() < threeMonthsAgo
    ).length
  }, [products])

  const [dismissedPairs, setDismissedPairs] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem(`hosti_dismissed_dupes_${venueId}`)
      return stored ? new Set(JSON.parse(stored)) : new Set()
    } catch { return new Set() }
  })

  const dismissPair = (pairKey: string) => {
    setDismissedPairs(prev => {
      const next = new Set([...prev, pairKey])
      try {
        localStorage.setItem(`hosti_dismissed_dupes_${venueId}`, JSON.stringify([...next]))
      } catch {}
      return next
    })
  }
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

  const dismissedArray = useMemo(() => [...dismissedPairs], [dismissedPairs])
  const duplicatePairs = useMemo(
    () => findDuplicatePairs(products.filter(p => p.active !== false)).filter(
      ([a, b]) => !dismissedArray.includes([a.id, b.id].sort().join(':'))
    ),
    [products, dismissedArray]
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

      {staleEstimateCount > 0 && (
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
          <span style={{ fontSize: 20, marginTop: 2 }}>💰</span>
          <p style={{ margin: 0, fontSize: 14, color: '#92400e' }}>
            <strong>{staleEstimateCount} estimated price{staleEstimateCount !== 1 ? 's' : ''}</strong> haven't been confirmed by a real invoice in over 3 months — worth checking these are still accurate.
          </p>
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
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
                  <button
                    type="button"
                    className={styles.mergeBtn}
                    onClick={() => setMergingProduct(a)}
                    title="Merge these duplicates"
                  >
                    Merge
                  </button>
                  <button
                    type="button"
                    onClick={() => dismissPair(pairKey)}
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
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
                <button
                  type="button"
                  className={styles.mergeBtn}
                  onClick={() => {
                    const found = products.find(p => p.id === c.newProductId)
                    if (!found) {
                      alert(`Product '${c.newProductName}' not found in local state — try refreshing the page.`)
                      return
                    }
                    setMergingCandidateId(c.id)
                    setMergingProduct(found)
                  }}
                  title="Merge this new product into the existing one"
                >
                  Merge
                </button>
                <button
                  type="button"
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
          <p className={styles.dropZoneHint}>Columns: Name, Unit, Size, Pack Size, Cost Price, Supplier</p>
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
                    <th>Size</th>
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
                      <td className={styles.cellText}>{row.size || '—'}</td>
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
        {scanProgress ? (
          <span style={{ fontSize: 13, color: '#6B7280', padding: '0 4px', whiteSpace: 'nowrap' }}>
            Scanning {scanProgress.current} of {scanProgress.total}…
          </span>
        ) : (
          <button
            type="button"
            className={styles.exportButton}
            onClick={scanForCatalogueMatches}
            disabled={loading || products.filter(p => p.costPrice == null).length === 0}
          >
            Scan catalogue
          </button>
        )}
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
                <th style={{ width: 88 }}></th>
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
                        className={styles.mergeBtn}
                        onClick={() => { setLinkingProduct(product); setRefreshLinkMsg(null) }}
                        title={product.linkedRecipeId ? `Recipe-linked: ${product.linkedRecipeName}` : 'Link to a recipe'}
                      >
                        🔗
                      </button>
                      {product.linkedRecipeId && (
                        <button
                          type="button"
                          className={styles.mergeBtn}
                          onClick={() => handleRefreshLinkedCost(product)}
                          title="Re-sync cost price from linked recipe"
                        >
                          ↻
                        </button>
                      )}
                      <button
                        type="button"
                        className={styles.mergeBtn}
                        onClick={() => setMergingProduct(product)}
                        title="Merge into another product"
                      >
                        Merge
                      </button>
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
                  {refreshLinkMsg?.id === product.id && (
                    <tr>
                      <td colSpan={COLUMNS.length + 2} style={{
                        padding: '4px 14px', fontSize: 12,
                        color: refreshLinkMsg.ok ? '#065f46' : '#991b1b',
                        background: refreshLinkMsg.ok ? '#f0fdf4' : '#fff5f5',
                        borderBottom: '1px solid #f1efe9',
                      }}>
                        {refreshLinkMsg.ok ? '✓ ' : '⚠ '}{refreshLinkMsg.msg}
                      </td>
                    </tr>
                  )}
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
      {managingSupplierProduct && (
        <SupplierManageModal
          venueId={venueId}
          productId={managingSupplierProduct.id}
          productName={managingSupplierProduct.name}
          suppliers={suppliers}
          onClose={() => setManagingSupplierProduct(null)}
        />
      )}
      {catalogueMatches !== null && (
        <CatalogueReviewModal
          matches={catalogueMatches}
          venueId={venueId}
          onClose={() => setCatalogueMatches(null)}
          onApplied={() => setCatalogueMatches(null)}
        />
      )}
      {linkingProduct && (
        <RecipeLinkModal
          venueId={venueId}
          product={linkingProduct}
          onClose={() => setLinkingProduct(null)}
        />
      )}
      {mergingProduct && (
        <MergeModal
          venueId={venueId}
          source={mergingProduct}
          allProducts={products}
          onClose={() => { setMergingProduct(null); setMergingCandidateId(null) }}
          onMergeComplete={mergingCandidateId ? (_targetId) => {
            const user = auth.currentUser
            updateDoc(doc(db, 'venues', venueId, 'productMatchCandidates', mergingCandidateId), {
              status: 'merged',
              reviewedBy: { uid: user?.uid || null, name: user?.displayName || 'Manager' },
              reviewedAt: serverTimestamp(),
            }).catch(e => console.error('[SetupProductsPage] mark candidate merged failed', e))
            setMergingCandidateId(null)
          } : undefined}
        />
      )}
    </div>
  )
}
