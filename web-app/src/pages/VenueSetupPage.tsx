import { Fragment, useEffect, useRef, useState } from 'react'
import {
  addDoc, collection, deleteDoc, doc, getDocs,
  onSnapshot, orderBy, query, serverTimestamp, updateDoc, writeBatch,
} from 'firebase/firestore'
import { db } from '../firebase'
import styles from './VenueSetupPage.module.css'

// ─── Types ────────────────────────────────────────────────────────────────────

type AreaNode = { id: string; name: string }
type DeptNode = { id: string; name: string; areas: AreaNode[] }

type Product = {
  id: string
  name: string
  category: string | null
  supplierName: string | null
  unit: string | null
  costPrice: number | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function batchDeleteAreas(venueId: string, deptId: string) {
  const snap = await getDocs(collection(db, 'venues', venueId, 'departments', deptId, 'areas'))
  if (snap.empty) return
  for (let i = 0; i < snap.docs.length; i += 499) {
    const batch = writeBatch(db)
    snap.docs.slice(i, i + 499).forEach(d => batch.delete(d.ref))
    await batch.commit()
  }
}

async function batchAssignProducts(
  venueId: string, deptId: string, areaId: string,
  products: Product[],
) {
  for (let i = 0; i < products.length; i += 499) {
    const batch = writeBatch(db)
    products.slice(i, i + 499).forEach(p => {
      batch.set(
        doc(db, 'venues', venueId, 'departments', deptId, 'areas', areaId, 'items', p.id),
        {
          name: p.name, unit: p.unit || null,
          supplierName: p.supplierName || null,
          productId: p.id, productName: p.name,
          inductionStatus: 'complete', inductionSource: 'desktop-bulk-assign',
          countingUnit: p.unit || 'unit', caseSize: null,
          createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        },
      )
    })
    await batch.commit()
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function VenueSetupPage({ venueId }: { venueId: string }) {
  // ── Dept/area tree ──────────────────────────────────────────────────────────
  const [structure, setStructure] = useState<DeptNode[]>([])
  const [loadingStructure, setLoadingStructure] = useState(true)

  // Rename state: { id, type: 'dept'|'area', deptId?, value }
  const [renaming, setRenaming] = useState<{ id: string; type: 'dept' | 'area'; deptId?: string; value: string } | null>(null)
  // Delete confirm
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; type: 'dept' | 'area'; deptId?: string; name: string } | null>(null)
  // Add dept input
  const [addingDept, setAddingDept] = useState(false)
  const [newDeptName, setNewDeptName] = useState('')
  // Add area input: key = deptId
  const [addingArea, setAddingArea] = useState<string | null>(null)
  const [newAreaName, setNewAreaName] = useState('')
  const renameRef = useRef<HTMLInputElement>(null)
  const addRef = useRef<HTMLInputElement>(null)

  // ── Products ────────────────────────────────────────────────────────────────
  const [products, setProducts] = useState<Product[]>([])
  // assignedMap: areaKey (`${deptId}/${areaId}`) -> Set<productId>
  const [assignedMap, setAssignedMap] = useState<Map<string, Set<string>>>(new Map())
  const [selectedArea, setSelectedArea] = useState<{ deptId: string; deptName: string; areaId: string; areaName: string } | null>(null)
  const [prodSearch, setProdSearch] = useState('')
  const [prodFilter, setProdFilter] = useState<'all' | 'assigned' | 'unassigned'>('all')
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set())
  const [bulkTargetArea, setBulkTargetArea] = useState<string>('')  // "deptId/areaId"
  const [assigning, setAssigning] = useState(false)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  // ── Load departments live ───────────────────────────────────────────────────
  useEffect(() => {
    setLoadingStructure(true)
    const unsub = onSnapshot(
      query(collection(db, 'venues', venueId, 'departments'), orderBy('createdAt', 'asc')),
      async (deptSnap) => {
        const depts: DeptNode[] = await Promise.all(
          deptSnap.docs.map(async (deptDoc) => {
            const areaSnap = await getDocs(
              query(collection(db, 'venues', venueId, 'departments', deptDoc.id, 'areas'), orderBy('createdAt', 'asc'))
            )
            return {
              id: deptDoc.id,
              name: (deptDoc.data() as any).name || deptDoc.id,
              areas: areaSnap.docs.map(a => ({ id: a.id, name: (a.data() as any).name || a.id })),
            }
          })
        )
        setStructure(depts)
        setLoadingStructure(false)
      },
      () => setLoadingStructure(false),
    )
    return unsub
  }, [venueId])

  // ── Load products once ──────────────────────────────────────────────────────
  useEffect(() => {
    getDocs(collection(db, 'venues', venueId, 'products')).then(snap => {
      setProducts(snap.docs.map(d => {
        const data = d.data() as any
        return { id: d.id, name: data.name || '', category: data.category ?? null, supplierName: data.supplierName ?? null, unit: data.unit ?? null, costPrice: data.costPrice ?? null }
      }).sort((a, b) => a.name.localeCompare(b.name)))
    }).catch(() => {})
  }, [venueId])

  // ── Load area assignments when selectedArea changes ─────────────────────────
  useEffect(() => {
    if (!selectedArea) return
    const { deptId, areaId } = selectedArea
    getDocs(collection(db, 'venues', venueId, 'departments', deptId, 'areas', areaId, 'items')).then(snap => {
      const key = `${deptId}/${areaId}`
      const ids = new Set(snap.docs.map(d => d.id))
      setAssignedMap(prev => new Map(prev).set(key, ids))
    }).catch(() => {})
  }, [venueId, selectedArea])

  // ── Tree actions ─────────────────────────────────────────────────────────────

  async function addDept() {
    const name = newDeptName.trim()
    if (!name) return
    await addDoc(collection(db, 'venues', venueId, 'departments'), { name, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
    setNewDeptName(''); setAddingDept(false)
  }

  async function addArea(deptId: string) {
    const name = newAreaName.trim()
    if (!name) return
    await addDoc(collection(db, 'venues', venueId, 'departments', deptId, 'areas'), { name, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
    setNewAreaName(''); setAddingArea(null)
  }

  async function renameDept(deptId: string, name: string) {
    if (!name.trim()) return
    await updateDoc(doc(db, 'venues', venueId, 'departments', deptId), { name: name.trim(), updatedAt: serverTimestamp() })
    setRenaming(null)
  }

  async function renameArea(deptId: string, areaId: string, name: string) {
    if (!name.trim()) return
    await updateDoc(doc(db, 'venues', venueId, 'departments', deptId, 'areas', areaId), { name: name.trim(), updatedAt: serverTimestamp() })
    setRenaming(null)
  }

  async function deleteDept(deptId: string) {
    await batchDeleteAreas(venueId, deptId)
    await deleteDoc(doc(db, 'venues', venueId, 'departments', deptId))
    setConfirmDelete(null)
  }

  async function deleteArea(deptId: string, areaId: string) {
    await deleteDoc(doc(db, 'venues', venueId, 'departments', deptId, 'areas', areaId))
    setConfirmDelete(null)
  }

  // Focus rename input on open
  useEffect(() => { if (renaming) setTimeout(() => renameRef.current?.focus(), 50) }, [renaming])
  useEffect(() => { if (addingDept || addingArea) setTimeout(() => addRef.current?.focus(), 50) }, [addingDept, addingArea])

  // ── Product assignment actions ───────────────────────────────────────────────

  const areaKey = selectedArea ? `${selectedArea.deptId}/${selectedArea.areaId}` : ''
  const assignedInArea = assignedMap.get(areaKey) ?? new Set<string>()

  const visibleProducts = products.filter(p => {
    const needle = prodSearch.trim().toLowerCase()
    if (needle && !p.name.toLowerCase().includes(needle) && !(p.category || '').toLowerCase().includes(needle)) return false
    if (prodFilter === 'assigned' && !assignedInArea.has(p.id)) return false
    if (prodFilter === 'unassigned' && assignedInArea.has(p.id)) return false
    return true
  })

  async function handleBulkAssign() {
    if (!bulkTargetArea || selectedProductIds.size === 0) return
    const [deptId, areaId] = bulkTargetArea.split('/')
    const dept = structure.find(d => d.id === deptId)
    const area = dept?.areas.find(a => a.id === areaId)
    if (!dept || !area) return
    setAssigning(true)
    const prods = products.filter(p => selectedProductIds.has(p.id))
    await batchAssignProducts(venueId, deptId, areaId, prods)
    // Refresh assignments for the target area
    const snap = await getDocs(collection(db, 'venues', venueId, 'departments', deptId, 'areas', areaId, 'items'))
    setAssignedMap(prev => new Map(prev).set(bulkTargetArea, new Set(snap.docs.map(d => d.id))))
    setSuccessMsg(`${prods.length} product${prods.length !== 1 ? 's' : ''} assigned to ${area.name}.`)
    setSelectedProductIds(new Set())
    setAssigning(false)
    setTimeout(() => setSuccessMsg(null), 4000)
  }

  // All areas flat for selectors
  const allAreas = structure.flatMap(d => d.areas.map(a => ({ deptId: d.id, deptName: d.name, areaId: a.id, areaName: a.name })))

  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>Venue Setup</h1>
      <p className={styles.subhead}>
        Build your venue structure — departments, areas, and product assignments.
        Everything set up here is immediately available in the mobile app.
      </p>

      {/* ── SECTION 1: Departments & Areas ── */}
      <div className={styles.section}>
        <p className={styles.sectionHeading}>Departments &amp; Areas</p>
        <p className={styles.sectionSubhead}>Add departments (Bar, Kitchen, Cellar) and the counting areas within each.</p>
        <div className={styles.card}>
          {loadingStructure ? (
            <p className={styles.loading}>Loading…</p>
          ) : structure.length === 0 && !addingDept ? (
            <p className={styles.emptyState}>
              No departments yet — add your first department below.<br />
              Departments are the main sections of your venue (e.g. Bar, Kitchen, Cellar).
            </p>
          ) : (
            structure.map(dept => (
              <Fragment key={dept.id}>
                {/* Department row */}
                <div className={styles.deptRow}>
                  {confirmDelete?.id === dept.id && confirmDelete.type === 'dept' ? (
                    <div className={styles.confirmRow}>
                      Delete <strong>{dept.name}</strong> and all its areas? Existing stocktake data is preserved.
                      <button className={styles.confirmYes} onClick={() => deleteDept(dept.id)}>Delete</button>
                      <button className={styles.confirmNo} onClick={() => setConfirmDelete(null)}>Cancel</button>
                    </div>
                  ) : renaming?.id === dept.id && renaming.type === 'dept' ? (
                    <>
                      <input ref={renameRef} className={styles.inlineInput} value={renaming.value}
                        onChange={e => setRenaming(r => r ? { ...r, value: e.target.value } : r)}
                        onKeyDown={e => { if (e.key === 'Enter') renameDept(dept.id, renaming.value); if (e.key === 'Escape') setRenaming(null) }}
                        onBlur={() => renameDept(dept.id, renaming.value)}
                      />
                    </>
                  ) : (
                    <>
                      <span className={styles.deptName}>{dept.name}</span>
                      <button className={styles.iconBtn} onClick={() => setRenaming({ id: dept.id, type: 'dept', value: dept.name })} title="Rename">✎</button>
                      <button className={styles.deleteBtn} onClick={() => setConfirmDelete({ id: dept.id, type: 'dept', name: dept.name })} title="Delete">×</button>
                      <button className={styles.addAreaBtn} onClick={() => { setAddingArea(dept.id); setNewAreaName('') }}>+ Add area</button>
                    </>
                  )}
                </div>

                {/* Area rows */}
                {dept.areas.map(area => (
                  <div key={area.id} className={styles.areaRow}>
                    <span className={styles.areaIndent}>└──</span>
                    {confirmDelete?.id === area.id && confirmDelete.type === 'area' ? (
                      <div className={styles.confirmRow}>
                        Delete <strong>{area.name}</strong>? Existing stocktake data is preserved.
                        <button className={styles.confirmYes} onClick={() => deleteArea(dept.id, area.id)}>Delete</button>
                        <button className={styles.confirmNo} onClick={() => setConfirmDelete(null)}>Cancel</button>
                      </div>
                    ) : renaming?.id === area.id && renaming.type === 'area' ? (
                      <input ref={renameRef} className={styles.inlineInput} value={renaming.value}
                        onChange={e => setRenaming(r => r ? { ...r, value: e.target.value } : r)}
                        onKeyDown={e => { if (e.key === 'Enter') renameArea(dept.id, area.id, renaming.value); if (e.key === 'Escape') setRenaming(null) }}
                        onBlur={() => renameArea(dept.id, area.id, renaming.value)}
                      />
                    ) : (
                      <>
                        <span className={styles.areaName}>{area.name}</span>
                        <button className={styles.iconBtn} onClick={() => setRenaming({ id: area.id, type: 'area', deptId: dept.id, value: area.name })} title="Rename">✎</button>
                        <button className={styles.deleteBtn} onClick={() => setConfirmDelete({ id: area.id, type: 'area', deptId: dept.id, name: area.name })} title="Delete">×</button>
                      </>
                    )}
                  </div>
                ))}

                {/* Add area input */}
                {addingArea === dept.id && (
                  <div className={styles.areaRow}>
                    <span className={styles.areaIndent}>└──</span>
                    <input ref={addRef} className={styles.inlineInput} value={newAreaName}
                      onChange={e => setNewAreaName(e.target.value)} placeholder="Area name"
                      onKeyDown={e => { if (e.key === 'Enter') addArea(dept.id); if (e.key === 'Escape') setAddingArea(null) }}
                      onBlur={() => { if (newAreaName.trim()) addArea(dept.id); else setAddingArea(null) }}
                    />
                  </div>
                )}
              </Fragment>
            ))
          )}

          {/* Add department */}
          {addingDept ? (
            <div className={styles.addDeptRow}>
              <input ref={addRef} className={styles.inlineInput} value={newDeptName}
                onChange={e => setNewDeptName(e.target.value)} placeholder="Department name"
                onKeyDown={e => { if (e.key === 'Enter') addDept(); if (e.key === 'Escape') setAddingDept(false) }}
                onBlur={() => { if (newDeptName.trim()) addDept(); else setAddingDept(false) }}
              />
            </div>
          ) : (
            <button className={styles.addDeptBtn} onClick={() => { setAddingDept(true); setNewDeptName('') }}>
              + Add department
            </button>
          )}
        </div>
      </div>

      {/* ── SECTION 2: Product assignments ── */}
      <div className={styles.section}>
        <p className={styles.sectionHeading}>Product Area Assignments</p>
        <p className={styles.sectionSubhead}>Assign products to the areas where they are counted. Select an area, then tick products to assign in bulk.</p>

        <div className={styles.areaSelector}>
          <select
            className={styles.areaSelect}
            value={selectedArea ? `${selectedArea.deptId}/${selectedArea.areaId}` : ''}
            onChange={e => {
              const val = e.target.value
              if (!val) { setSelectedArea(null); return }
              const [deptId, areaId] = val.split('/')
              const match = allAreas.find(a => a.deptId === deptId && a.areaId === areaId)
              if (match) { setSelectedArea(match); setProdSearch(''); setProdFilter('all'); setSelectedProductIds(new Set()) }
            }}
          >
            <option value="">Select an area…</option>
            {structure.map(dept => (
              <optgroup key={dept.id} label={dept.name}>
                {dept.areas.map(area => (
                  <option key={area.id} value={`${dept.id}/${area.id}`}>{area.name}</option>
                ))}
              </optgroup>
            ))}
          </select>

          {selectedArea && (
            <>
              <input className={styles.searchInput} placeholder="Search products…" value={prodSearch} onChange={e => setProdSearch(e.target.value)} />
              <div className={styles.filterGroup}>
                {(['all', 'assigned', 'unassigned'] as const).map(f => (
                  <button key={f} type="button"
                    className={`${styles.filterBtn} ${prodFilter === f ? styles.filterBtnActive : ''}`}
                    onClick={() => setProdFilter(f)}
                  >
                    {f === 'all' ? 'All' : f === 'assigned' ? 'Assigned' : 'Not assigned'}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {!selectedArea ? (
          <div className={styles.noAreaSelected}>Select an area above to see product assignments.</div>
        ) : products.length === 0 ? (
          <div className={styles.noAreaSelected}>No products yet — add products in the Products page first, then assign them to areas here.</div>
        ) : (
          <>
            {/* Bulk toolbar */}
            {selectedProductIds.size > 0 && (
              <div className={styles.bulkToolbar}>
                <span>{selectedProductIds.size} selected</span>
                <span>Assign to:</span>
                <select className={styles.areaSelect} style={{ minWidth: 180 }} value={bulkTargetArea} onChange={e => setBulkTargetArea(e.target.value)}>
                  <option value="">Choose area…</option>
                  {structure.map(dept => (
                    <optgroup key={dept.id} label={dept.name}>
                      {dept.areas.map(area => (
                        <option key={area.id} value={`${dept.id}/${area.id}`}>{area.name}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <button className={styles.bulkApplyBtn} onClick={handleBulkAssign} disabled={!bulkTargetArea || assigning}>
                  {assigning ? 'Assigning…' : 'Apply'}
                </button>
                <button className={styles.bulkClearBtn} onClick={() => setSelectedProductIds(new Set())}>Clear</button>
              </div>
            )}

            {successMsg && <p className={styles.successMsg}>✓ {successMsg}</p>}

            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th style={{ width: 36 }}>
                      <input type="checkbox"
                        checked={selectedProductIds.size === visibleProducts.length && visibleProducts.length > 0}
                        onChange={e => setSelectedProductIds(e.target.checked ? new Set(visibleProducts.map(p => p.id)) : new Set())}
                      />
                    </th>
                    <th>Product</th>
                    <th>Category</th>
                    <th>Supplier</th>
                    <th>In this area</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleProducts.map(p => {
                    const isAssigned = assignedInArea.has(p.id)
                    return (
                      <tr key={p.id} className={styles.dataRow}>
                        <td className={styles.td}>
                          <input type="checkbox" checked={selectedProductIds.has(p.id)}
                            onChange={e => {
                              const n = new Set(selectedProductIds)
                              if (e.target.checked) n.add(p.id); else n.delete(p.id)
                              setSelectedProductIds(n)
                            }}
                          />
                        </td>
                        <td className={styles.td}>{p.name}</td>
                        <td className={styles.td}>{p.category || '—'}</td>
                        <td className={styles.td}>{p.supplierName && p.supplierName !== 'Unassigned' ? p.supplierName : '—'}</td>
                        <td className={styles.td}>
                          {isAssigned
                            ? <span className={styles.assignedBadge}>✓ Assigned</span>
                            : <span className={styles.notAssigned}>—</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p style={{ fontSize: 12, color: '#9ca3af', marginTop: 8 }}>{visibleProducts.length} products</p>
          </>
        )}
      </div>
    </div>
  )
}
