import { useEffect, useRef, useState } from 'react'
import type { User } from 'firebase/auth'
import {
  addDoc, collection, doc, onSnapshot, serverTimestamp, updateDoc,
} from 'firebase/firestore'
import { db } from '../firebase'
import styles from './FestivalEventSetupPage.module.css'

type EventDetails = {
  eventName: string
  eventType: string
  startDate: string
  endDate: string
  dailyAttendance: number | null
  totalBudget: number | null
  pricePositioning: string
  bufferPercent: number
  venueAddress: string | null
}

type Bar = {
  id: string
  name: string
  type: string
}

const EVENT_TYPES = [
  { value: 'music_festival', label: 'Music Festival' },
  { value: 'food_wine',      label: 'Food & Wine' },
  { value: 'sports',         label: 'Sports' },
  { value: 'corporate',      label: 'Corporate' },
  { value: 'community',      label: 'Community' },
  { value: 'default',        label: 'Other' },
]

const PRICE_OPTIONS = [
  { value: 'budget',  label: 'Budget' },
  { value: 'mid',     label: 'Mid-range' },
  { value: 'premium', label: 'Premium' },
  { value: 'mixed',   label: 'Mixed' },
]

const BUFFER_OPTIONS = [5, 10, 15, 20, 25, 30]

const BAR_TYPES = ['20ft Container', '40ft Container', 'Marquee', 'Portable', 'Fixed', 'Other']

function calcDateDiff(start: string, end: string): number | null {
  if (!start || !end) return null
  try {
    const s = new Date(start).getTime()
    const e = new Date(end).getTime()
    const days = Math.round((e - s) / 86400000) + 1
    return days > 0 ? days : null
  } catch { return null }
}

function calcDaysUntil(start: string): number | null {
  if (!start) return null
  try {
    const diff = Math.round((new Date(start).getTime() - Date.now()) / 86400000)
    return diff
  } catch { return null }
}

export default function FestivalEventSetupPage({ venueId, user: _user }: { venueId: string; user: User }) {
  const [details, setDetails] = useState<EventDetails>({
    eventName: '',
    eventType: 'music_festival',
    startDate: '',
    endDate: '',
    dailyAttendance: null,
    totalBudget: null,
    pricePositioning: 'mid',
    bufferPercent: 15,
    venueAddress: null,
  })
  const [bars, setBars] = useState<Bar[]>([])
  const [loading, setLoading] = useState(true)
  const [savedField, setSavedField] = useState<string | null>(null)
  const [confirmDeleteBarId, setConfirmDeleteBarId] = useState<string | null>(null)
  const [editingBarName, setEditingBarName] = useState<string | null>(null)
  const barNameRefs = useRef<Record<string, HTMLInputElement | null>>({})

  // Live event details
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, 'venues', venueId, 'event', 'details'),
      (snap) => {
        if (snap.exists()) {
          const d = snap.data() as any
          setDetails({
            eventName:        d.eventName        ?? '',
            eventType:        d.eventType        ?? 'music_festival',
            startDate:        d.startDate        ?? '',
            endDate:          d.endDate          ?? '',
            dailyAttendance:  d.dailyAttendance  ?? null,
            totalBudget:      d.totalBudget      ?? null,
            pricePositioning: d.pricePositioning ?? 'mid',
            bufferPercent:    d.bufferPercent    ?? 15,
            venueAddress:     d.venueAddress     ?? null,
          })
        }
        setLoading(false)
      },
      () => setLoading(false),
    )
    return unsub
  }, [venueId])

  // Live bars (departments with isFestivalBar == true)
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'venues', venueId, 'departments'),
      (snap) => {
        const rows: Bar[] = snap.docs
          .filter(d => (d.data() as any).isFestivalBar)
          .map(d => {
            const data = d.data() as any
            return { id: d.id, name: data.name || '', type: data.barType || 'Other' }
          })
        setBars(rows)
      },
      () => {},
    )
    return unsub
  }, [venueId])

  async function saveField(field: keyof EventDetails, value: unknown) {
    try {
      await updateDoc(doc(db, 'venues', venueId, 'event', 'details'), {
        [field]: value,
        updatedAt: serverTimestamp(),
      })
      setSavedField(field)
      setTimeout(() => setSavedField(null), 1500)
    } catch (e) {
      console.error('[FestivalSetup] save failed', field, e)
    }
  }

  async function addBar() {
    try {
      const ref = await addDoc(collection(db, 'venues', venueId, 'departments'), {
        name: 'New Bar',
        isFestivalBar: true,
        barType: 'Other',
        createdAt: serverTimestamp(),
      })
      setEditingBarName(ref.id)
      setTimeout(() => barNameRefs.current[ref.id]?.focus(), 100)
    } catch (e) {
      console.error('[FestivalSetup] addBar failed', e)
    }
  }

  async function saveBarName(barId: string, name: string) {
    try {
      await updateDoc(doc(db, 'venues', venueId, 'departments', barId), {
        name: name.trim() || 'New Bar',
        updatedAt: serverTimestamp(),
      })
    } catch {}
    setEditingBarName(null)
  }

  async function saveBarType(barId: string, type: string) {
    try {
      await updateDoc(doc(db, 'venues', venueId, 'departments', barId), {
        barType: type,
        updatedAt: serverTimestamp(),
      })
    } catch {}
  }

  async function deleteBar(barId: string) {
    try {
      await updateDoc(doc(db, 'venues', venueId, 'departments', barId), {
        isFestivalBar: false,
        updatedAt: serverTimestamp(),
      })
    } catch {}
    setConfirmDeleteBarId(null)
  }

  // Derived summary values
  const eventDays = calcDateDiff(details.startDate, details.endDate)
  const totalAttendance = eventDays != null && details.dailyAttendance != null
    ? eventDays * details.dailyAttendance
    : null
  const budgetPerPerson = totalAttendance && details.totalBudget && totalAttendance > 0
    ? (details.totalBudget / totalAttendance).toFixed(2)
    : null
  const daysUntil = calcDaysUntil(details.startDate)

  // suppress unused warning — prop kept for future use
  void editingBarName

  if (loading) return <p className={styles.loading}>Loading event details…</p>

  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>Event Setup</h1>
      <p className={styles.subhead}>Configure your festival event. All changes save automatically.</p>

      <div className={styles.twoCol}>
        {/* ── LEFT: Event Details ── */}
        <div>
          <div className={styles.card}>
            <h2 className={styles.cardHeading}>Event Details</h2>

            {/* Event name */}
            <div className={styles.field}>
              <div className={styles.fieldLabel}>
                Event name
                {savedField === 'eventName' && <span className={styles.savedBadge}>✓ Saved</span>}
              </div>
              <input
                className={styles.input}
                value={details.eventName}
                onChange={e => setDetails(p => ({ ...p, eventName: e.target.value }))}
                onBlur={e => saveField('eventName', e.target.value)}
                placeholder="e.g. Rhythm & Vines 2026"
              />
            </div>

            {/* Event type */}
            <div className={styles.field}>
              <div className={styles.fieldLabel}>
                Event type
                {savedField === 'eventType' && <span className={styles.savedBadge}>✓ Saved</span>}
              </div>
              <div className={styles.chipRow}>
                {EVENT_TYPES.map(t => (
                  <button
                    key={t.value}
                    type="button"
                    className={`${styles.chip} ${details.eventType === t.value ? styles.chipActive : ''}`}
                    onClick={() => { setDetails(p => ({ ...p, eventType: t.value })); saveField('eventType', t.value) }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Dates */}
            <div className={styles.field}>
              <div className={styles.fieldLabel}>
                Start date
                {savedField === 'startDate' && <span className={styles.savedBadge}>✓ Saved</span>}
              </div>
              <input
                className={styles.input}
                type="date"
                value={details.startDate}
                onChange={e => { setDetails(p => ({ ...p, startDate: e.target.value })); saveField('startDate', e.target.value) }}
              />
            </div>

            <div className={styles.field}>
              <div className={styles.fieldLabel}>
                End date
                {savedField === 'endDate' && <span className={styles.savedBadge}>✓ Saved</span>}
              </div>
              <input
                className={styles.input}
                type="date"
                value={details.endDate}
                onChange={e => { setDetails(p => ({ ...p, endDate: e.target.value })); saveField('endDate', e.target.value) }}
              />
              {eventDays != null && (
                <p className={styles.dateDiff}>{eventDays} day{eventDays !== 1 ? 's' : ''}</p>
              )}
            </div>

            {/* Daily attendance */}
            <div className={styles.field}>
              <div className={styles.fieldLabel}>
                Expected daily attendance
                {savedField === 'dailyAttendance' && <span className={styles.savedBadge}>✓ Saved</span>}
              </div>
              <input
                className={styles.input}
                type="number"
                value={details.dailyAttendance ?? ''}
                onChange={e => setDetails(p => ({ ...p, dailyAttendance: e.target.value ? Number(e.target.value) : null }))}
                onBlur={e => saveField('dailyAttendance', e.target.value ? Number(e.target.value) : null)}
                placeholder="e.g. 5000"
              />
            </div>

            {/* Total budget */}
            <div className={styles.field}>
              <div className={styles.fieldLabel}>
                Total beverage budget
                {savedField === 'totalBudget' && <span className={styles.savedBadge}>✓ Saved</span>}
              </div>
              <div className={styles.prefixInput}>
                <span className={styles.prefix}>$</span>
                <input
                  type="number"
                  value={details.totalBudget ?? ''}
                  onChange={e => setDetails(p => ({ ...p, totalBudget: e.target.value ? Number(e.target.value) : null }))}
                  onBlur={e => saveField('totalBudget', e.target.value ? Number(e.target.value) : null)}
                  placeholder="e.g. 50000"
                />
              </div>
            </div>

            {/* Audience pricing */}
            <div className={styles.field}>
              <div className={styles.fieldLabel}>
                Audience pricing
                {savedField === 'pricePositioning' && <span className={styles.savedBadge}>✓ Saved</span>}
              </div>
              <div className={styles.chipRow}>
                {PRICE_OPTIONS.map(p => (
                  <button
                    key={p.value}
                    type="button"
                    className={`${styles.chip} ${details.pricePositioning === p.value ? styles.chipActive : ''}`}
                    onClick={() => { setDetails(prev => ({ ...prev, pricePositioning: p.value })); saveField('pricePositioning', p.value) }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Safety buffer */}
            <div className={styles.field}>
              <div className={styles.fieldLabel}>
                Safety buffer
                {savedField === 'bufferPercent' && <span className={styles.savedBadge}>✓ Saved</span>}
              </div>
              <div className={styles.chipRow}>
                {BUFFER_OPTIONS.map(b => (
                  <button
                    key={b}
                    type="button"
                    className={`${styles.chip} ${details.bufferPercent === b ? styles.chipActive : ''}`}
                    onClick={() => { setDetails(p => ({ ...p, bufferPercent: b })); saveField('bufferPercent', b) }}
                  >
                    {b}%{b === 15 ? ' ✓' : ''}
                  </button>
                ))}
              </div>
            </div>

            {/* Venue address */}
            <div className={styles.field}>
              <div className={styles.fieldLabel}>
                Venue address
                {savedField === 'venueAddress' && <span className={styles.savedBadge}>✓ Saved</span>}
              </div>
              <input
                className={styles.input}
                value={details.venueAddress ?? ''}
                onChange={e => setDetails(p => ({ ...p, venueAddress: e.target.value || null }))}
                onBlur={e => saveField('venueAddress', e.target.value || null)}
                placeholder="e.g. Gisborne Showgrounds, Gisborne"
              />
            </div>
          </div>
        </div>

        {/* ── RIGHT: Summary + Bars ── */}
        <div>
          {/* Event Summary */}
          <div className={styles.card}>
            <h2 className={styles.cardHeading}>Event Summary</h2>
            <div className={styles.summaryRow}>
              <span className={styles.summaryLabel}>Duration</span>
              <span className={styles.summaryValue}>{eventDays != null ? `${eventDays} day${eventDays !== 1 ? 's' : ''}` : '—'}</span>
            </div>
            <div className={styles.summaryRow}>
              <span className={styles.summaryLabel}>Total attendance</span>
              <span className={styles.summaryValue}>{totalAttendance != null ? totalAttendance.toLocaleString('en-NZ') + ' people' : '—'}</span>
            </div>
            <div className={styles.summaryRow}>
              <span className={styles.summaryLabel}>Budget per person</span>
              <span className={styles.summaryValue}>{budgetPerPerson != null ? `$${budgetPerPerson}` : '—'}</span>
            </div>
            <div className={styles.summaryRow}>
              <span className={styles.summaryLabel}>Days until event</span>
              <span className={styles.summaryValue}>
                {daysUntil != null
                  ? daysUntil > 0 ? `${daysUntil} days` : daysUntil === 0 ? 'Today!' : `${Math.abs(daysUntil)} days ago`
                  : '—'}
              </span>
            </div>
          </div>

          {/* Bars */}
          <div className={styles.card}>
            <h2 className={styles.cardHeading}>
              Bars{' '}
              <span style={{ fontSize: 13, fontWeight: 500, color: '#6b7280' }}>
                {bars.length} bar{bars.length !== 1 ? 's' : ''}
              </span>
            </h2>
            {bars.length > 0 && (
              <table className={styles.barTable}>
                <thead>
                  <tr><th>Name</th><th>Type</th><th></th></tr>
                </thead>
                <tbody>
                  {bars.map(bar => (
                    <tr key={bar.id}>
                      <td>
                        {confirmDeleteBarId === bar.id ? (
                          <div className={styles.confirmDelete}>
                            Delete {bar.name}?
                            <button className={styles.confirmDeleteYes} onClick={() => deleteBar(bar.id)}>Delete</button>
                            <button className={styles.confirmDeleteNo} onClick={() => setConfirmDeleteBarId(null)}>Cancel</button>
                          </div>
                        ) : (
                          <input
                            ref={el => { barNameRefs.current[bar.id] = el }}
                            className={styles.barNameInput}
                            defaultValue={bar.name}
                            onFocus={() => setEditingBarName(bar.id)}
                            onBlur={e => { saveBarName(bar.id, e.target.value); setEditingBarName(null) }}
                          />
                        )}
                      </td>
                      <td>
                        <select
                          className={styles.barTypeSelect}
                          value={bar.type}
                          onChange={e => saveBarType(bar.id, e.target.value)}
                        >
                          {BAR_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </td>
                      <td>
                        {confirmDeleteBarId !== bar.id && (
                          <button
                            className={styles.deleteBarBtn}
                            onClick={() => setConfirmDeleteBarId(bar.id)}
                            title="Delete bar"
                          >
                            ×
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <button className={styles.addBarBtn} onClick={addBar}>+ Add bar</button>
          </div>
        </div>
      </div>
    </div>
  )
}
