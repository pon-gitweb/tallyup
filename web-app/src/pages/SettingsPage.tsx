import { useEffect, useState } from 'react'
import type { User } from 'firebase/auth'
import { doc, getDoc, onSnapshot, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore'
import { db } from '../firebase'
import styles from './SettingsPage.module.css'

// ─── Types ────────────────────────────────────────────────────────────────────

type VenueData = {
  name: string
  country: string | null
  timezone: string | null
  ownerUid: string | null
}

type LabourSettings = {
  hourlyRate: number | null
  baselineMinutes: number | null
  targetDaysOfCover: number | null
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function SettingsPage({ venueId, user }: { venueId: string; user: User }) {
  const [venue, setVenue] = useState<VenueData | null>(null)
  const [_labour, setLabour] = useState<LabourSettings | null>(null)
  const [loading, setLoading] = useState(true)

  const [editingName, setEditingName] = useState(false)
  const [nameInput, setNameInput] = useState('')
  const [nameSaving, setNameSaving] = useState(false)

  // Labour edit state
  const [hourlyRate, setHourlyRate] = useState<string>('')
  const [baselineMinutes, setBaselineMinutes] = useState<string>('')
  const [targetDaysOfCover, setTargetDaysOfCover] = useState<string>('')
  const [labourSaving, setLabourSaving] = useState<string | null>(null)
  const [labourSaved, setLabourSaved] = useState<string | null>(null)

  // Country edit state
  const [editingCountry, setEditingCountry] = useState(false)

  // Labour settings — one-shot read
  useEffect(() => {
    getDoc(doc(db, 'venues', venueId, 'settings', 'labour'))
      .then((snap) => {
        if (snap.exists()) {
          const d = snap.data() as any
          setLabour({
            hourlyRate: d.hourlyRate ?? null,
            baselineMinutes: d.baselineMinutes ?? d.targetCountingMinutes ?? null,
            targetDaysOfCover: d.targetDaysOfCover ?? null,
          })
          setHourlyRate(d.hourlyRate != null ? String(d.hourlyRate) : '')
          setBaselineMinutes(d.baselineMinutes != null ? String(d.baselineMinutes) : '')
          setTargetDaysOfCover(d.targetDaysOfCover != null ? String(d.targetDaysOfCover) : '')
        }
      })
      .catch(() => {})
  }, [venueId])

  // Live venue doc
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, 'venues', venueId),
      (snap) => {
        if (snap.exists()) {
          const d = snap.data() as any
          setVenue({
            name: d.name ?? '',
            country: d.country ?? null,
            timezone: d.timezone ?? null,
            ownerUid: d.ownerUid ?? null,
          })
        }
        setLoading(false)
      },
      () => setLoading(false),
    )
    return unsub
  }, [venueId])

  const isOwner = venue?.ownerUid === user.uid

  async function saveName() {
    if (!nameInput.trim() || nameSaving) return
    setNameSaving(true)
    try {
      await updateDoc(doc(db, 'venues', venueId), { name: nameInput.trim() })
      setEditingName(false)
    } catch {}
    setNameSaving(false)
  }

  async function saveLabourField(field: 'hourlyRate' | 'baselineMinutes' | 'targetDaysOfCover', raw: string) {
    const num = parseFloat(raw)
    if (isNaN(num) || num < 0) return
    setLabourSaving(field)
    try {
      await setDoc(
        doc(db, 'venues', venueId, 'settings', 'labour'),
        { [field]: num, updatedAt: serverTimestamp() },
        { merge: true },
      )
      setLabourSaved(field)
      setTimeout(() => setLabourSaved(null), 1500)
    } catch {}
    setLabourSaving(null)
  }

  if (loading) return <p className={styles.loading}>Loading account…</p>

  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>Account</h1>
      <p className={styles.subhead}>Venue details and operational settings.</p>

      <div className={styles.cardsStack}>
        {/* Venue Details */}
        <div className={styles.card}>
          <h2 className={styles.cardHeading}>Venue Details</h2>

          <div className={styles.fieldRow}>
            <span className={styles.fieldLabel}>Venue name</span>
            {editingName ? (
              <div className={styles.editRow}>
                <input
                  className={styles.editInput}
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveName()
                    if (e.key === 'Escape') setEditingName(false)
                  }}
                  autoFocus
                />
                <button type="button" className={styles.editSave} onClick={saveName} disabled={nameSaving}>
                  {nameSaving ? 'Saving…' : 'Save'}
                </button>
                <button type="button" className={styles.editCancel} onClick={() => setEditingName(false)}>
                  Cancel
                </button>
              </div>
            ) : (
              <div className={styles.fieldValueRow}>
                <span className={styles.fieldValue}>{venue?.name || '—'}</span>
                {isOwner && (
                  <button
                    type="button"
                    className={styles.pencilBtn}
                    title="Edit venue name"
                    onClick={() => { setNameInput(venue?.name ?? ''); setEditingName(true) }}
                  >
                    ✎
                  </button>
                )}
              </div>
            )}
          </div>

          <div className={styles.fieldRow}>
            <span className={styles.fieldLabel}>Country</span>
            {editingCountry ? (
              <div className={styles.editRow}>
                <select
                  className={styles.editInput}
                  defaultValue={venue?.country ?? ''}
                  autoFocus
                  onChange={async (e) => {
                    await updateDoc(doc(db, 'venues', venueId), { country: e.target.value })
                    setEditingCountry(false)
                  }}
                  onBlur={() => setEditingCountry(false)}
                >
                  <option value="">Select country</option>
                  <option value="NZ">New Zealand</option>
                  <option value="AU">Australia</option>
                </select>
              </div>
            ) : (
              <div className={styles.fieldValueRow}>
                <span className={styles.fieldValue}>
                  {venue?.country === 'NZ' ? '🇳🇿 New Zealand' : venue?.country === 'AU' ? '🇦🇺 Australia' : '—'}
                </span>
                {isOwner && (
                  <button type="button" className={styles.pencilBtn} onClick={() => setEditingCountry(true)}>✎</button>
                )}
              </div>
            )}
          </div>

          <div className={styles.fieldRow}>
            <span className={styles.fieldLabel}>Timezone</span>
            <span className={styles.fieldValue}>{venue?.timezone || '—'}</span>
          </div>
        </div>

        {/* Labour Settings */}
        <div className={styles.card}>
          <h2 className={styles.cardHeading}>Labour Settings</h2>

          <div className={styles.fieldRow}>
            <span className={styles.fieldLabel}>
              Hourly rate
              {labourSaved === 'hourlyRate' && <span className={styles.savedBadge}>✓ Saved</span>}
            </span>
            <div className={styles.editRow}>
              <span className={styles.prefix}>$</span>
              <input
                className={`${styles.editInput} ${styles.editInputWithPrefix}`}
                type="number"
                min="0"
                step="0.50"
                value={hourlyRate}
                onChange={e => setHourlyRate(e.target.value)}
                onBlur={e => saveLabourField('hourlyRate', e.target.value)}
                onKeyDown={e => e.key === 'Enter' && saveLabourField('hourlyRate', hourlyRate)}
                placeholder="e.g. 32.00"
              />
              <span className={styles.fieldUnit}>/hr</span>
              {labourSaving === 'hourlyRate' && <span className={styles.savingNote}>Saving…</span>}
            </div>
          </div>

          <div className={styles.fieldRow}>
            <span className={styles.fieldLabel}>
              Stocktake baseline
              {labourSaved === 'baselineMinutes' && <span className={styles.savedBadge}>✓ Saved</span>}
            </span>
            <div className={styles.editRow}>
              <input
                className={styles.editInput}
                type="number"
                min="0"
                step="5"
                value={baselineMinutes}
                onChange={e => setBaselineMinutes(e.target.value)}
                onBlur={e => saveLabourField('baselineMinutes', e.target.value)}
                onKeyDown={e => e.key === 'Enter' && saveLabourField('baselineMinutes', baselineMinutes)}
                placeholder="e.g. 90"
              />
              <span className={styles.fieldUnit}>minutes</span>
              {labourSaving === 'baselineMinutes' && <span className={styles.savingNote}>Saving…</span>}
            </div>
          </div>

          <div className={styles.fieldRow}>
            <span className={styles.fieldLabel}>
              Target days of cover
              {labourSaved === 'targetDaysOfCover' && <span className={styles.savedBadge}>✓ Saved</span>}
            </span>
            <div className={styles.editRow}>
              <input
                className={styles.editInput}
                type="number"
                min="1"
                max="60"
                step="1"
                value={targetDaysOfCover}
                onChange={e => setTargetDaysOfCover(e.target.value)}
                onBlur={e => saveLabourField('targetDaysOfCover', e.target.value)}
                onKeyDown={e => e.key === 'Enter' && saveLabourField('targetDaysOfCover', targetDaysOfCover)}
                placeholder="e.g. 10"
              />
              <span className={styles.fieldUnit}>days</span>
              {labourSaving === 'targetDaysOfCover' && <span className={styles.savingNote}>Saving…</span>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
