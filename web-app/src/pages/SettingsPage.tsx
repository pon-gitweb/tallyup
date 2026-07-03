import { useEffect, useState } from 'react'
import type { User } from 'firebase/auth'
import { doc, getDoc, onSnapshot, updateDoc } from 'firebase/firestore'
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
  const [labour, setLabour] = useState<LabourSettings | null>(null)
  const [loading, setLoading] = useState(true)

  const [editingName, setEditingName] = useState(false)
  const [nameInput, setNameInput] = useState('')
  const [nameSaving, setNameSaving] = useState(false)

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
            <span className={styles.fieldValue}>{venue?.country || '—'}</span>
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
            <span className={styles.fieldLabel}>Hourly rate</span>
            <span className={styles.fieldValue}>
              {labour?.hourlyRate != null ? `$${labour.hourlyRate.toFixed(2)}/hr` : '—'}
            </span>
          </div>
          <div className={styles.fieldRow}>
            <span className={styles.fieldLabel}>Stocktake baseline</span>
            <span className={styles.fieldValue}>
              {labour?.baselineMinutes != null ? `${labour.baselineMinutes} minutes` : '—'}
            </span>
          </div>
          <div className={styles.fieldRow}>
            <span className={styles.fieldLabel}>Target days of cover</span>
            <span className={styles.fieldValue}>
              {labour?.targetDaysOfCover != null ? `${labour.targetDaysOfCover} days` : '—'}
            </span>
          </div>
          <p className={styles.mobileNote}>
            Edit these settings in the mobile app under Settings.
          </p>
        </div>
      </div>
    </div>
  )
}
