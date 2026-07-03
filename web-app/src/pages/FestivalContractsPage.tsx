import { Fragment, useEffect, useState } from 'react'
import {
  addDoc, collection, deleteDoc, doc, getDocs, onSnapshot, serverTimestamp, updateDoc,
} from 'firebase/firestore'
import { db } from '../firebase'
import styles from './FestivalContractsPage.module.css'

type ContractTab = 'riders' | 'activations' | 'agreements'

type Rider = {
  id: string
  artistName: string
  requirements: string
  products: string
  deliveryDate: string | null
  barId: string | null
  barName: string | null
  status: string
}

type Activation = {
  id: string
  brandName: string
  barId: string | null
  barName: string | null
  products: Array<{ name: string; qty: number }>
  status: string
}

type Agreement = {
  id: string
  supplierName: string
  minVolume: number | null
  productName: string
  notes: string
  commitmentMet: boolean
}

type Bar = { id: string; name: string }
type Supplier = { id: string; name: string }

function fmtDate(d: string | null): string {
  if (!d) return '—'
  try { return new Date(d).toLocaleDateString('en-NZ', { day: '2-digit', month: 'short', year: 'numeric' }) }
  catch { return d }
}

export default function FestivalContractsPage({ venueId }: { venueId: string }) {
  const [activeTab, setActiveTab] = useState<ContractTab>('riders')
  const [riders, setRiders] = useState<Rider[]>([])
  const [activations, setActivations] = useState<Activation[]>([])
  const [agreements, setAgreements] = useState<Agreement[]>([])
  const [bars, setBars] = useState<Bar[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  // Add forms
  const [showAddRider, setShowAddRider] = useState(false)
  const [showAddActivation, setShowAddActivation] = useState(false)
  const [showAddAgreement, setShowAddAgreement] = useState(false)

  // Rider form state
  const [riderArtist, setRiderArtist] = useState('')
  const [riderReqs, setRiderReqs] = useState('')
  const [riderProducts, setRiderProducts] = useState('')
  const [riderDate, setRiderDate] = useState('')
  const [riderBar, setRiderBar] = useState('')
  const [riderStatus, setRiderStatus] = useState('pending')

  // Activation form state
  const [actBrand, setActBrand] = useState('')
  const [actBar, setActBar] = useState('')
  const [actStatus, setActStatus] = useState('scheduled')
  const [actProductRows, setActProductRows] = useState<Array<{ name: string; qty: string }>>([{ name: '', qty: '1' }])

  // Agreement form state
  const [agrSupplier, setAgrSupplier] = useState('')
  const [agrMinVolume, setAgrMinVolume] = useState('')
  const [agrProduct, setAgrProduct] = useState('')
  const [agrNotes, setAgrNotes] = useState('')

  // Load bars
  useEffect(() => {
    getDocs(collection(db, 'venues', venueId, 'departments')).then(snap => {
      setBars(snap.docs.filter(d => (d.data() as any).isFestivalBar).map(d => ({ id: d.id, name: (d.data() as any).name || d.id })))
    }).catch(() => {})
  }, [venueId])

  // Load suppliers
  useEffect(() => {
    getDocs(collection(db, 'venues', venueId, 'suppliers')).then(snap => {
      setSuppliers(snap.docs.map(d => ({ id: d.id, name: (d.data() as any).name || d.id })))
    }).catch(() => {})
  }, [venueId])

  // Live riders
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'venues', venueId, 'riders'), snap => {
      const rows: Rider[] = snap.docs.map(d => {
        const data = d.data() as any
        return { id: d.id, artistName: data.artistName || '', requirements: data.requirements || '', products: data.products || '', deliveryDate: data.deliveryDate ?? null, barId: data.barId ?? null, barName: data.barName ?? null, status: data.status || 'pending' }
      }).sort((a, b) => a.artistName.localeCompare(b.artistName))
      setRiders(rows)
    }, () => {})
    return unsub
  }, [venueId])

  // Live activations
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'venues', venueId, 'activations'), snap => {
      const rows: Activation[] = snap.docs.map(d => {
        const data = d.data() as any
        return { id: d.id, brandName: data.brandName || '', barId: data.barId ?? null, barName: data.barName ?? null, products: data.products || [], status: data.status || 'scheduled' }
      })
      setActivations(rows)
    }, () => {})
    return unsub
  }, [venueId])

  // Live agreements
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'venues', venueId, 'contracts'), snap => {
      const rows: Agreement[] = snap.docs.map(d => {
        const data = d.data() as any
        return { id: d.id, supplierName: data.supplierName || '', minVolume: data.minVolume ?? null, productName: data.productName || '', notes: data.notes || '', commitmentMet: data.commitmentMet ?? false }
      })
      setAgreements(rows)
    }, () => {})
    return unsub
  }, [venueId])

  function statusStyle(status: string): React.CSSProperties {
    switch (status) {
      case 'delivered': case 'confirmed': return { background: '#dcfce7', color: '#166534' }
      case 'processing': case 'scheduled': return { background: '#dbeafe', color: '#1e40af' }
      case 'partial': return { background: '#fed7aa', color: '#92400e' }
      default: return { background: '#fef3c7', color: '#92400e' }
    }
  }

  async function saveRider() {
    if (!riderArtist.trim()) return
    const bar = bars.find(b => b.id === riderBar)
    await addDoc(collection(db, 'venues', venueId, 'riders'), {
      artistName: riderArtist.trim(), requirements: riderReqs, products: riderProducts,
      deliveryDate: riderDate || null, barId: riderBar || null, barName: bar?.name ?? null,
      status: riderStatus, createdAt: serverTimestamp(),
    })
    setShowAddRider(false); setRiderArtist(''); setRiderReqs(''); setRiderProducts(''); setRiderDate(''); setRiderBar(''); setRiderStatus('pending')
  }

  async function saveActivation() {
    if (!actBrand.trim()) return
    const bar = bars.find(b => b.id === actBar)
    await addDoc(collection(db, 'venues', venueId, 'activations'), {
      brandName: actBrand.trim(), barId: actBar || null, barName: bar?.name ?? null,
      products: actProductRows.filter(r => r.name.trim()).map(r => ({ name: r.name.trim(), qty: parseInt(r.qty) || 1 })),
      status: actStatus, createdAt: serverTimestamp(),
    })
    setShowAddActivation(false); setActBrand(''); setActBar(''); setActStatus('scheduled'); setActProductRows([{ name: '', qty: '1' }])
  }

  async function saveAgreement() {
    if (!agrSupplier.trim()) return
    await addDoc(collection(db, 'venues', venueId, 'contracts'), {
      supplierName: agrSupplier.trim(), minVolume: parseInt(agrMinVolume) || null,
      productName: agrProduct.trim(), notes: agrNotes, commitmentMet: false, createdAt: serverTimestamp(),
    })
    setShowAddAgreement(false); setAgrSupplier(''); setAgrMinVolume(''); setAgrProduct(''); setAgrNotes('')
  }

  async function toggleCommitment(agreement: Agreement) {
    await updateDoc(doc(db, 'venues', venueId, 'contracts', agreement.id), { commitmentMet: !agreement.commitmentMet, updatedAt: serverTimestamp() })
  }

  async function deleteItem(collection_: string, id: string) {
    await deleteDoc(doc(db, 'venues', venueId, collection_, id))
    setConfirmDeleteId(null)
  }

  const TAB_LABELS: Record<ContractTab, string> = { riders: 'Riders', activations: 'Activations', agreements: 'Agreements' }

  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>Contracts</h1>
      <p className={styles.subhead}>Manage artist riders, brand activations, and supplier agreements.</p>

      {/* Tab bar */}
      <div className={styles.tabBar}>
        {(['riders', 'activations', 'agreements'] as ContractTab[]).map(tab => (
          <button key={tab} type="button"
            className={`${styles.tab} ${activeTab === tab ? styles.tabActive : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {TAB_LABELS[tab]}
            <span className={styles.tabCount}>
              {tab === 'riders' ? riders.length : tab === 'activations' ? activations.length : agreements.length}
            </span>
          </button>
        ))}
      </div>

      {/* ── RIDERS TAB ── */}
      {activeTab === 'riders' && (
        <div>
          <div className={styles.sectionToolbar}>
            <span style={{ fontSize: 13, color: '#6B7280' }}>{riders.length} rider{riders.length !== 1 ? 's' : ''}</span>
            <button type="button" className={styles.addBtn} onClick={() => setShowAddRider(v => !v)}>+ Add rider</button>
          </div>

          {showAddRider && (
            <div className={styles.addForm}>
              <div className={styles.formRow}>
                <label className={styles.formLabel}>Artist name *</label>
                <input className={styles.formInput} value={riderArtist} onChange={e => setRiderArtist(e.target.value)} placeholder="e.g. DJ Smith" />
              </div>
              <div className={styles.formRow}>
                <label className={styles.formLabel}>Requirements</label>
                <textarea className={styles.formTextarea} rows={3} value={riderReqs} onChange={e => setRiderReqs(e.target.value)} placeholder="Rider requirements…" />
              </div>
              <div className={styles.formRow}>
                <label className={styles.formLabel}>Products needed</label>
                <input className={styles.formInput} value={riderProducts} onChange={e => setRiderProducts(e.target.value)} placeholder="e.g. 2× Champagne, 6× Beer" />
              </div>
              <div className={styles.formGrid}>
                <div className={styles.formRow}>
                  <label className={styles.formLabel}>Delivery date</label>
                  <input className={styles.formInput} type="date" value={riderDate} onChange={e => setRiderDate(e.target.value)} />
                </div>
                <div className={styles.formRow}>
                  <label className={styles.formLabel}>Bar</label>
                  <select className={styles.formSelect} value={riderBar} onChange={e => setRiderBar(e.target.value)}>
                    <option value="">Select bar…</option>
                    {bars.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
                <div className={styles.formRow}>
                  <label className={styles.formLabel}>Status</label>
                  <select className={styles.formSelect} value={riderStatus} onChange={e => setRiderStatus(e.target.value)}>
                    <option value="pending">Pending</option>
                    <option value="processing">Processing</option>
                    <option value="delivered">Delivered</option>
                    <option value="partial">Partial</option>
                  </select>
                </div>
              </div>
              <div className={styles.formActions}>
                <button type="button" className={styles.saveBtn} onClick={saveRider} disabled={!riderArtist.trim()}>Save rider</button>
                <button type="button" className={styles.cancelBtn} onClick={() => setShowAddRider(false)}>Cancel</button>
              </div>
            </div>
          )}

          {riders.length === 0 ? (
            <div className={styles.emptyState}><p className={styles.emptyText}>No riders yet — add artist riders above.</p></div>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead><tr><th>Artist</th><th>Requirements</th><th>Products</th><th>Delivery</th><th>Bar</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {riders.map(r => (
                    <Fragment key={r.id}>
                      <tr className={styles.dataRow} onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}>
                        <td className={styles.td}>{r.artistName}</td>
                        <td className={styles.td} style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.requirements || '—'}</td>
                        <td className={styles.td}>{r.products || '—'}</td>
                        <td className={styles.td}>{fmtDate(r.deliveryDate)}</td>
                        <td className={styles.td}>{r.barName || '—'}</td>
                        <td className={styles.td}><span className={styles.statusBadge} style={statusStyle(r.status)}>{r.status}</span></td>
                        <td className={styles.tdAction}>
                          {confirmDeleteId !== r.id ? (
                            <button type="button" className={styles.deleteBtn} onClick={e => { e.stopPropagation(); setConfirmDeleteId(r.id) }}>×</button>
                          ) : (
                            <span onClick={e => e.stopPropagation()}>
                              <button type="button" className={styles.confirmYes} onClick={() => deleteItem('riders', r.id)}>Del</button>
                              <button type="button" className={styles.confirmNo} onClick={() => setConfirmDeleteId(null)}>No</button>
                            </span>
                          )}
                        </td>
                      </tr>
                      {expandedId === r.id && (
                        <tr><td colSpan={7} className={styles.expandCell}>
                          <strong>Requirements:</strong> {r.requirements || '—'}<br />
                          <strong>Products:</strong> {r.products || '—'}
                        </td></tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── ACTIVATIONS TAB ── */}
      {activeTab === 'activations' && (
        <div>
          <div className={styles.sectionToolbar}>
            <span style={{ fontSize: 13, color: '#6B7280' }}>{activations.length} activation{activations.length !== 1 ? 's' : ''}</span>
            <button type="button" className={styles.addBtn} onClick={() => setShowAddActivation(v => !v)}>+ Add activation</button>
          </div>

          {showAddActivation && (
            <div className={styles.addForm}>
              <div className={styles.formRow}>
                <label className={styles.formLabel}>Brand name *</label>
                <input className={styles.formInput} value={actBrand} onChange={e => setActBrand(e.target.value)} placeholder="e.g. Heineken" />
              </div>
              <div className={styles.formGrid}>
                <div className={styles.formRow}>
                  <label className={styles.formLabel}>Bar</label>
                  <select className={styles.formSelect} value={actBar} onChange={e => setActBar(e.target.value)}>
                    <option value="">Select bar…</option>
                    {bars.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
                <div className={styles.formRow}>
                  <label className={styles.formLabel}>Status</label>
                  <select className={styles.formSelect} value={actStatus} onChange={e => setActStatus(e.target.value)}>
                    <option value="scheduled">Scheduled</option>
                    <option value="confirmed">Confirmed</option>
                    <option value="pending">Pending</option>
                  </select>
                </div>
              </div>
              <div className={styles.formRow}>
                <label className={styles.formLabel}>Products</label>
                {actProductRows.map((pr, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                    <input className={styles.formInput} style={{ flex: 1 }} value={pr.name} onChange={e => setActProductRows(prev => prev.map((p, j) => j === i ? { ...p, name: e.target.value } : p))} placeholder="Product name" />
                    <input className={styles.formInput} style={{ width: 70, textAlign: 'center' }} type="number" value={pr.qty} onChange={e => setActProductRows(prev => prev.map((p, j) => j === i ? { ...p, qty: e.target.value } : p))} />
                    <button type="button" style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer' }} onClick={() => setActProductRows(prev => prev.filter((_, j) => j !== i))}>×</button>
                  </div>
                ))}
                <button type="button" className={styles.addProductBtn} onClick={() => setActProductRows(prev => [...prev, { name: '', qty: '1' }])}>+ Add product</button>
              </div>
              <div className={styles.formActions}>
                <button type="button" className={styles.saveBtn} onClick={saveActivation} disabled={!actBrand.trim()}>Save activation</button>
                <button type="button" className={styles.cancelBtn} onClick={() => setShowAddActivation(false)}>Cancel</button>
              </div>
            </div>
          )}

          {activations.length === 0 ? (
            <div className={styles.emptyState}><p className={styles.emptyText}>No activations yet — add brand activations above.</p></div>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead><tr><th>Brand</th><th>Bar</th><th>Products</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {activations.map(a => (
                    <tr key={a.id} className={styles.dataRow}>
                      <td className={styles.td}>{a.brandName}</td>
                      <td className={styles.td}>{a.barName || '—'}</td>
                      <td className={styles.td}>{a.products.length > 0 ? a.products.map(p => `${p.name} ×${p.qty}`).join(', ') : '—'}</td>
                      <td className={styles.td}><span className={styles.statusBadge} style={statusStyle(a.status)}>{a.status}</span></td>
                      <td className={styles.tdAction}>
                        {confirmDeleteId !== a.id ? (
                          <button type="button" className={styles.deleteBtn} onClick={() => setConfirmDeleteId(a.id)}>×</button>
                        ) : (
                          <span>
                            <button type="button" className={styles.confirmYes} onClick={() => deleteItem('activations', a.id)}>Del</button>
                            <button type="button" className={styles.confirmNo} onClick={() => setConfirmDeleteId(null)}>No</button>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── AGREEMENTS TAB ── */}
      {activeTab === 'agreements' && (
        <div>
          <div className={styles.sectionToolbar}>
            <span style={{ fontSize: 13, color: '#6B7280' }}>{agreements.length} agreement{agreements.length !== 1 ? 's' : ''}</span>
            <button type="button" className={styles.addBtn} onClick={() => setShowAddAgreement(v => !v)}>+ Add agreement</button>
          </div>

          {showAddAgreement && (
            <div className={styles.addForm}>
              <div className={styles.formGrid}>
                <div className={styles.formRow}>
                  <label className={styles.formLabel}>Supplier *</label>
                  <select className={styles.formSelect} value={agrSupplier} onChange={e => setAgrSupplier(e.target.value)}>
                    <option value="">Select supplier…</option>
                    {suppliers.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                    <option value="__custom">Other (type below)</option>
                  </select>
                  {agrSupplier === '__custom' && (
                    <input className={styles.formInput} style={{ marginTop: 6 }} placeholder="Supplier name" onChange={e => setAgrSupplier(e.target.value)} />
                  )}
                </div>
                <div className={styles.formRow}>
                  <label className={styles.formLabel}>Min. volume (units)</label>
                  <input className={styles.formInput} type="number" value={agrMinVolume} onChange={e => setAgrMinVolume(e.target.value)} placeholder="e.g. 500" />
                </div>
              </div>
              <div className={styles.formRow}>
                <label className={styles.formLabel}>Product</label>
                <input className={styles.formInput} value={agrProduct} onChange={e => setAgrProduct(e.target.value)} placeholder="e.g. Heineken 330ml" />
              </div>
              <div className={styles.formRow}>
                <label className={styles.formLabel}>Notes</label>
                <textarea className={styles.formTextarea} rows={2} value={agrNotes} onChange={e => setAgrNotes(e.target.value)} placeholder="Additional terms…" />
              </div>
              <div className={styles.formActions}>
                <button type="button" className={styles.saveBtn} onClick={saveAgreement} disabled={!agrSupplier.trim() || agrSupplier === '__custom'}>Save agreement</button>
                <button type="button" className={styles.cancelBtn} onClick={() => setShowAddAgreement(false)}>Cancel</button>
              </div>
            </div>
          )}

          {agreements.length === 0 ? (
            <div className={styles.emptyState}><p className={styles.emptyText}>No supplier agreements yet — add minimum volume commitments above.</p></div>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead><tr><th>Supplier</th><th>Min. volume</th><th>Product</th><th>Notes</th><th>Commitment</th><th></th></tr></thead>
                <tbody>
                  {agreements.map(a => (
                    <tr key={a.id} className={styles.dataRow}>
                      <td className={styles.td}>{a.supplierName}</td>
                      <td className={styles.td}>{a.minVolume != null ? `${a.minVolume} units` : '—'}</td>
                      <td className={styles.td}>{a.productName || '—'}</td>
                      <td className={styles.td}>{a.notes || '—'}</td>
                      <td className={styles.td}>
                        <button
                          type="button"
                          className={a.commitmentMet ? styles.metBtn : styles.notMetBtn}
                          onClick={() => toggleCommitment(a)}
                        >
                          {a.commitmentMet ? '✓ Met' : '⏱ Pending'}
                        </button>
                      </td>
                      <td className={styles.tdAction}>
                        {confirmDeleteId !== a.id ? (
                          <button type="button" className={styles.deleteBtn} onClick={() => setConfirmDeleteId(a.id)}>×</button>
                        ) : (
                          <span>
                            <button type="button" className={styles.confirmYes} onClick={() => deleteItem('contracts', a.id)}>Del</button>
                            <button type="button" className={styles.confirmNo} onClick={() => setConfirmDeleteId(null)}>No</button>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
