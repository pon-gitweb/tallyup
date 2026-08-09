import { useState } from 'react'
import { createVenue, seedDefaultDepartments } from '../services/venues'
import type { VenueRow } from './ProjectsPage'
import styles from './CreateVenuePage.module.css'

export default function CreateVenuePage({
  onOpenVenue,
}: {
  onOpenVenue: (venue: VenueRow) => void
}) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) { setError('Please enter a venue name.'); return }

    setError(null)
    setBusy(true)
    try {
      // 1) Create venue via Cloud Function (mirrors CreateVenueScreen.tsx step 1)
      const venueId = await createVenue(trimmed)

      // 2) Seed default departments + areas — non-fatal (mirrors step 2)
      try {
        await seedDefaultDepartments(venueId)
      } catch (seedErr: any) {
        console.warn('[CreateVenuePage] seedDefaultDepartments failed:', seedErr?.message)
      }

      // 3) Route into the new venue dashboard (mirrors step 3 — VenueProvider picks up
      //    the new venueId, here we pass the VenueRow directly via openVenue).
      const newVenue: VenueRow = {
        id: venueId,
        name: trimmed,
        venueType: 'venue',
        score: null,
        scoreLabel: null,
        varianceDollars: null,
        stockValue: null,
        estimatedImpact: null,
        totalStocktakesCompleted: 0,
        lastCompletedAt: null,
        paretoTop10: [],
        prevParetoTop10: [],
        snapshotLoaded: false,
      }
      onOpenVenue(newVenue)
      // onOpenVenue calls setActiveVenue + setPage('hostihealth') in App.tsx.
      // Component unmounts naturally — no setBusy(false) needed on the success path.
    } catch (err: any) {
      setError(err?.message ?? 'Could not create venue. Please try again.')
      setBusy(false)
    }
  }

  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>Create your first venue</h1>
      <p className={styles.subhead}>
        You&rsquo;re signed in but not attached to any venue yet. Create one to get started.
      </p>

      <div className={styles.card}>
        {error && <p className={styles.error}>{error}</p>}

        <form onSubmit={handleSubmit}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="venue-name">Venue name</label>
            <input
              id="venue-name"
              type="text"
              className={styles.input}
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. The Front Bar"
              autoFocus
              disabled={busy}
            />
          </div>
          <button type="submit" className={styles.submit} disabled={busy || !name.trim()}>
            {busy ? 'Creating…' : 'Create venue →'}
          </button>
        </form>
      </div>

      <div className={styles.altCard}>
        <p className={styles.altHeading}>Already have a venue?</p>
        <p className={styles.altBody}>
          Ask your venue admin to invite you. You&rsquo;ll receive an invitation link by email.
        </p>
      </div>
    </div>
  )
}
