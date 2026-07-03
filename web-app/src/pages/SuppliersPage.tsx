import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore'
import { db } from '../firebase'
import { theme } from '../theme'
import styles from './SuppliersPage.module.css'

type OrderingMethod = 'email' | 'portal' | 'phone'

type Supplier = {
  id: string
  name: string
  email: string | null
  phone: string | null
  accountNumber: string | null
  orderingMethod: OrderingMethod
  defaultLeadDays: number | null
  portalUrl: string | null
  orderCutoffLocalTime: string | null
  mergeWindowHours: number | null
  repName: string | null
  notes: string | null
}

type EditableField = 'name' | 'email' | 'phone' | 'accountNumber' | 'orderingMethod' | 'defaultLeadDays'

const COLUMNS: { field: EditableField; label: string }[] = [
  { field: 'name', label: 'Name' },
  { field: 'email', label: 'Email' },
  { field: 'phone', label: 'Phone' },
  { field: 'accountNumber', label: 'Account #' },
  { field: 'orderingMethod', label: 'Ordering method' },
  { field: 'defaultLeadDays', label: 'Lead days' },
]

const DRAFT_PREFIX = '__draft_'

function blankDraft(id: string): Supplier {
  return {
    id,
    name: '',
    email: null,
    phone: null,
    accountNumber: null,
    orderingMethod: 'email',
    defaultLeadDays: 2,
    portalUrl: null,
    orderCutoffLocalTime: null,
    mergeWindowHours: null,
    repName: null,
    notes: null,
  }
}

function isValidHHmm(s: string): boolean {
  if (!s) return true // blank means "not set"
  const m = /^(\d{2}):(\d{2})$/.exec(s.trim())
  if (!m) return false
  const hh = Number(m[1])
  const mm = Number(m[2])
  return hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59
}

function displayValue(s: Supplier, field: EditableField): string {
  switch (field) {
    case 'name':
      return s.name || ''
    case 'email':
      return s.email || ''
    case 'phone':
      return s.phone || ''
    case 'accountNumber':
      return s.accountNumber || ''
    case 'orderingMethod':
      return s.orderingMethod || 'email'
    case 'defaultLeadDays':
      return s.defaultLeadDays != null ? String(s.defaultLeadDays) : ''
  }
}

// Shared per-field parsing — used both to build a Firestore patch (existing
// suppliers) and to update the local draft object (new, not-yet-saved row).
function parseFieldValue(field: EditableField, raw: string): string | number | null {
  const trimmed = raw.trim()
  switch (field) {
    case 'name':
      return trimmed
    case 'email':
      return trimmed || null
    case 'phone':
      return trimmed || null
    case 'accountNumber':
      return trimmed || null
    case 'orderingMethod':
      return (trimmed as OrderingMethod) || 'email'
    case 'defaultLeadDays': {
      let n = trimmed === '' ? 2 : Math.round(Number(trimmed))
      if (!Number.isFinite(n)) n = 2
      if (n < 1) n = 1 // "Lead days ... min 1"
      return n
    }
  }
}

function getAdjacentCell(
  rows: Supplier[],
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

export default function SuppliersPage({ venueId }: { venueId: string }) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  const [editingCell, setEditingCell] = useState<{ id: string; field: EditableField } | null>(null)
  const [editValue, setEditValue] = useState('')
  const skipNextBlur = useRef(false)
  const inputRefs = useRef<Record<string, HTMLInputElement | HTMLSelectElement | null>>({})

  const [draftSupplier, setDraftSupplier] = useState<Supplier | null>(null)
  const draftCounter = useRef(0)

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Product counts — fetched once, not on every snapshot update (new
  // suppliers added afterwards simply show 0, which is correct since a
  // brand-new supplier has no linked products yet).
  const [productCounts, setProductCounts] = useState<Record<string, number>>({})
  const [countsLoading, setCountsLoading] = useState(true)
  const countsFetched = useRef(false)

  useEffect(() => {
    setLoading(true)
    const unsub = onSnapshot(
      collection(db, 'venues', venueId, 'suppliers'),
      (snap) => {
        const rows: Supplier[] = snap.docs.map((d) => {
          const data = d.data() as any
          return {
            id: d.id,
            name: data.name || '',
            email: data.email ?? null,
            phone: data.phone ?? null,
            accountNumber: data.accountNumber ?? null,
            orderingMethod: (data.orderingMethod as OrderingMethod) || 'email',
            defaultLeadDays: data.defaultLeadDays ?? null,
            portalUrl: data.portalUrl ?? null,
            orderCutoffLocalTime: data.orderCutoffLocalTime ?? null,
            mergeWindowHours: data.mergeWindowHours ?? null,
            repName: data.repName ?? null,
            notes: data.notes ?? null,
          }
        })
        setSuppliers(rows)
        setLoading(false)
        if (!countsFetched.current) {
          countsFetched.current = true
          loadProductCounts(rows)
        }
      },
      () => setLoading(false)
    )
    return unsub
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venueId])

  async function loadProductCounts(rows: Supplier[]) {
    if (rows.length === 0) {
      setCountsLoading(false)
      return
    }
    setCountsLoading(true)
    const counts: Record<string, number> = {}
    await Promise.all(
      rows.map(async (s) => {
        const seen = new Set<string>()
        try {
          const queries = [
            getDocs(query(collection(db, 'venues', venueId, 'products'), where('supplierId', '==', s.id))),
            getDocs(
              query(collection(db, 'venues', venueId, 'products'), where('primarySupplierId', '==', s.id))
            ),
          ]
          if (s.name) {
            queries.push(
              getDocs(query(collection(db, 'venues', venueId, 'products'), where('supplierName', '==', s.name)))
            )
          }
          const snaps = await Promise.all(queries)
          for (const snap of snaps) snap.forEach((d) => seen.add(d.id))
        } catch {
          /* leave count at whatever was collected before the failure */
        }
        counts[s.id] = seen.size
      })
    )
    setProductCounts(counts)
    setCountsLoading(false)
  }

  // Focus the active cell once it's rendered.
  useEffect(() => {
    if (!editingCell) return
    inputRefs.current[`${editingCell.id}:${editingCell.field}`]?.focus()
  }, [editingCell, suppliers, draftSupplier])

  // Finalize the draft row (save if named, discard if blank) once editing
  // moves to a different row entirely — not just a different field on it.
  useEffect(() => {
    if (!draftSupplier) return
    if (editingCell && editingCell.id === draftSupplier.id) return
    finalizeDraft()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingCell])

  async function finalizeDraft() {
    const draft = draftSupplier
    if (!draft) return
    setDraftSupplier(null)
    if (!draft.name.trim()) return // discard silently — no name entered
    try {
      await addDoc(collection(db, 'venues', venueId, 'suppliers'), {
        name: draft.name.trim(),
        email: draft.email,
        phone: draft.phone,
        accountNumber: draft.accountNumber,
        orderingMethod: draft.orderingMethod,
        portalUrl: draft.portalUrl,
        defaultLeadDays: draft.defaultLeadDays ?? 2,
        orderCutoffLocalTime: draft.orderCutoffLocalTime,
        mergeWindowHours: draft.mergeWindowHours,
        createdAt: serverTimestamp(),
      })
    } catch (e) {
      console.error('[SuppliersPage] failed to create supplier', e)
    }
  }

  const visibleRows = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return suppliers
    return suppliers.filter(
      (s) =>
        s.name.toLowerCase().includes(needle) ||
        (s.email || '').toLowerCase().includes(needle) ||
        (s.phone || '').toLowerCase().includes(needle)
    )
  }, [suppliers, search])

  function rowsContaining(id: string): Supplier[] {
    return draftSupplier && id === draftSupplier.id ? [draftSupplier] : visibleRows
  }

  function commitEdit(id: string, field: EditableField, rawValue: string) {
    const value = parseFieldValue(field, rawValue)
    if (draftSupplier && id === draftSupplier.id) {
      setDraftSupplier((prev) => (prev ? { ...prev, [field]: value } : prev))
      return
    }
    updateDoc(doc(db, 'venues', venueId, 'suppliers', id), { [field]: value }).catch((e) => {
      console.error('[SuppliersPage] failed to save field', field, e)
    })
  }

  function startEdit(supplier: Supplier, field: EditableField) {
    setEditingCell({ id: supplier.id, field })
    setEditValue(displayValue(supplier, field))
  }

  function handleBlur() {
    if (skipNextBlur.current) {
      skipNextBlur.current = false
      return
    }
    if (editingCell) commitEdit(editingCell.id, editingCell.field, editValue)
    setEditingCell(null)
  }

  function handleCellKeyDown(e: React.KeyboardEvent<HTMLInputElement | HTMLSelectElement>) {
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
      const rows = rowsContaining(editingCell.id)
      const next = getAdjacentCell(rows, editingCell.id, editingCell.field, e.shiftKey ? -1 : 1)
      if (next) {
        const nextRow = rows.find((r) => r.id === next.id)!
        setEditingCell(next)
        setEditValue(displayValue(nextRow, next.field))
      } else {
        setEditingCell(null)
      }
    }
  }

  async function handleAddSupplierClick() {
    await finalizeDraft() // resolve any prior draft first
    draftCounter.current += 1
    const id = `${DRAFT_PREFIX}${draftCounter.current}`
    setDraftSupplier(blankDraft(id))
    setEditingCell({ id, field: 'name' })
    setEditValue('')
  }

  function toggleExpand(id: string) {
    setExpandedId((prev) => (prev === id ? null : id))
  }

  async function handleConfirmDelete(id: string) {
    try {
      await deleteDoc(doc(db, 'venues', venueId, 'suppliers', id))
    } catch (e) {
      console.error('[SuppliersPage] failed to delete supplier', e)
    } finally {
      setConfirmDeleteId(null)
    }
  }

  function renderCell(supplier: Supplier, field: EditableField) {
    const isEditing = editingCell?.id === supplier.id && editingCell.field === field

    if (field === 'orderingMethod') {
      if (isEditing) {
        return (
          <select
            ref={(el) => {
              inputRefs.current[`${supplier.id}:${field}`] = el
            }}
            className={styles.cellSelect}
            value={editValue}
            onChange={(e) => {
              const val = e.target.value
              skipNextBlur.current = true
              commitEdit(supplier.id, field, val)
              setEditingCell(null)
            }}
            onBlur={handleBlur}
            onKeyDown={handleCellKeyDown}
          >
            <option value="email">Email</option>
            <option value="portal">Portal</option>
            <option value="phone">Phone</option>
          </select>
        )
      }
      const label = supplier.orderingMethod
      return (
        <div className={styles.cellText} onClick={() => startEdit(supplier, field)}>
          {label.charAt(0).toUpperCase() + label.slice(1)}
        </div>
      )
    }

    if (field === 'name') {
      if (isEditing) {
        return (
          <input
            ref={(el) => {
              inputRefs.current[`${supplier.id}:${field}`] = el
            }}
            className={styles.cellInput}
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={handleBlur}
            onKeyDown={handleCellKeyDown}
          />
        )
      }
      return (
        <div className={styles.nameCell}>
          <span className={styles.nameText} onClick={() => toggleExpand(supplier.id)}>
            {supplier.name || '—'}
          </span>
          <button
            type="button"
            className={styles.nameEditTrigger}
            onClick={() => startEdit(supplier, field)}
            aria-label="Edit name"
          >
            ✎
          </button>
        </div>
      )
    }

    if (isEditing) {
      return (
        <input
          ref={(el) => {
            inputRefs.current[`${supplier.id}:${field}`] = el
          }}
          className={styles.cellInput}
          type={field === 'defaultLeadDays' ? 'number' : 'text'}
          min={field === 'defaultLeadDays' ? 1 : undefined}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={handleCellKeyDown}
        />
      )
    }
    const value = displayValue(supplier, field)
    return (
      <div
        className={`${styles.cellText} ${!value ? styles.cellTextEmpty : ''}`}
        onClick={() => startEdit(supplier, field)}
      >
        {value || '—'}
      </div>
    )
  }

  function renderRow(supplier: Supplier, isDraft: boolean) {
    return (
      <Fragment key={supplier.id}>
        <tr>
          {COLUMNS.map((col) => (
            <td key={col.field}>{renderCell(supplier, col.field)}</td>
          ))}
          <td className={styles.readonlyCell}>
            {countsLoading ? '—' : productCounts[supplier.id] ?? 0}
          </td>
          <td className={styles.actionCell}>
            {isDraft ? null : confirmDeleteId === supplier.id ? (
              <div className={styles.deleteConfirmRow}>
                <span className={styles.deleteConfirmText}>
                  Delete {supplier.name || 'this supplier'}? Products will become unassigned.
                </span>
                <button
                  type="button"
                  className={styles.deleteConfirmButton}
                  style={{ background: theme.error }}
                  onClick={() => handleConfirmDelete(supplier.id)}
                >
                  Delete
                </button>
                <button
                  type="button"
                  className={styles.deleteCancelButton}
                  onClick={() => setConfirmDeleteId(null)}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                className={styles.deleteTrigger}
                onClick={() => setConfirmDeleteId(supplier.id)}
                aria-label="Delete supplier"
              >
                🗑
              </button>
            )}
          </td>
        </tr>
        {!isDraft && expandedId === supplier.id && (
          <tr className={styles.expandRow}>
            <td colSpan={COLUMNS.length + 2}>
              <ExpandPanel supplier={supplier} venueId={venueId} />
            </td>
          </tr>
        )}
      </Fragment>
    )
  }

  return (
    <div>
      <h1 className={styles.heading}>Suppliers</h1>
      <p className={styles.subhead}>Manage suppliers with a real keyboard.</p>

      <div className={styles.toolbar}>
        <input
          className={styles.search}
          placeholder="Search by name, email, or phone"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button type="button" className={styles.addButton} onClick={handleAddSupplierClick}>
          + Add supplier
        </button>
      </div>

      {loading ? (
        <p className={styles.loading}>Loading suppliers…</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                {COLUMNS.map((col) => (
                  <th key={col.field}>{col.label}</th>
                ))}
                <th>Products</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {draftSupplier && renderRow(draftSupplier, true)}
              {visibleRows.map((supplier) => renderRow(supplier, false))}
            </tbody>
          </table>
          {!draftSupplier && visibleRows.length === 0 && (
            <p className={styles.empty}>
              {search.trim() ? 'No suppliers match your search.' : 'No suppliers yet — add one above.'}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function ExpandPanel({ supplier, venueId }: { supplier: Supplier; venueId: string }) {
  const [repName, setRepName] = useState(supplier.repName ?? '')
  const [notes, setNotes] = useState(supplier.notes ?? '')
  const [portalUrl, setPortalUrl] = useState(supplier.portalUrl ?? '')
  const [cutoff, setCutoff] = useState(supplier.orderCutoffLocalTime ?? '')
  const [mergeHours, setMergeHours] = useState(
    supplier.mergeWindowHours != null ? String(supplier.mergeWindowHours) : ''
  )

  useEffect(() => {
    setRepName(supplier.repName ?? '')
    setNotes(supplier.notes ?? '')
    setPortalUrl(supplier.portalUrl ?? '')
    setCutoff(supplier.orderCutoffLocalTime ?? '')
    setMergeHours(supplier.mergeWindowHours != null ? String(supplier.mergeWindowHours) : '')
  }, [supplier.id, supplier.repName, supplier.notes, supplier.portalUrl, supplier.orderCutoffLocalTime, supplier.mergeWindowHours])

  async function saveField(
    field: 'portalUrl' | 'orderCutoffLocalTime' | 'mergeWindowHours' | 'repName' | 'notes',
    raw: string,
  ) {
    const trimmed = raw.trim()
    let value: string | number | null
    if (field === 'mergeWindowHours') {
      const n = trimmed === '' ? null : Math.round(Number(trimmed))
      value = n != null && Number.isFinite(n) ? n : null
    } else if (field === 'orderCutoffLocalTime') {
      if (!isValidHHmm(trimmed)) return // skip an invalid time rather than save garbage
      value = trimmed || null
    } else {
      value = trimmed || null
    }
    try {
      await updateDoc(doc(db, 'venues', venueId, 'suppliers', supplier.id), { [field]: value })
    } catch (e) {
      console.error('[SuppliersPage] failed to save advanced field', field, e)
    }
  }

  return (
    <div className={styles.expandPanel}>
      <div className={styles.expandField}>
        <label className={styles.expandLabel}>Rep / contact name</label>
        <input
          className={styles.expandInput}
          value={repName}
          onChange={(e) => setRepName(e.target.value)}
          onBlur={(e) => saveField('repName', e.target.value)}
          placeholder="e.g. Sarah Jones"
        />
      </div>
      <div className={styles.expandField}>
        <label className={styles.expandLabel}>Notes</label>
        <textarea
          className={styles.expandTextarea}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={(e) => saveField('notes', e.target.value)}
          placeholder="Minimum orders, delivery windows, special instructions…"
          rows={3}
        />
      </div>
      <div className={styles.expandField}>
        <label className={styles.expandLabel}>Portal URL</label>
        <input
          className={styles.expandInput}
          value={portalUrl}
          onChange={(e) => setPortalUrl(e.target.value)}
          onBlur={(e) => saveField('portalUrl', e.target.value)}
          placeholder="https://…"
        />
      </div>
      <div className={styles.expandField}>
        <label className={styles.expandLabel}>Order cutoff (HH:mm)</label>
        <input
          className={styles.expandInput}
          value={cutoff}
          onChange={(e) => setCutoff(e.target.value)}
          onBlur={(e) => saveField('orderCutoffLocalTime', e.target.value)}
          placeholder="16:00"
        />
      </div>
      <div className={styles.expandField}>
        <label className={styles.expandLabel}>Merge window (hours)</label>
        <input
          className={styles.expandInput}
          type="number"
          min={0}
          value={mergeHours}
          onChange={(e) => setMergeHours(e.target.value)}
          onBlur={(e) => saveField('mergeWindowHours', e.target.value)}
          placeholder="e.g. 4"
        />
      </div>
    </div>
  )
}
