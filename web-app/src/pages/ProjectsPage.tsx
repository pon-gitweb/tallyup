import { useEffect, useRef, useState } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import type { User } from 'firebase/auth'
import { db } from '../firebase'
import styles from './ProjectsPage.module.css'

export type VenueRow = {
  id: string
  name: string
  venueType: string
}

async function loadVenues(uid: string): Promise<VenueRow[]> {
  const userSnap = await getDoc(doc(db, 'users', uid))
  const venueIds: string[] = userSnap.exists() ? (userSnap.data()?.venueIds ?? []) : []

  const rows = await Promise.all(
    venueIds.map(async (id) => {
      try {
        const venueSnap = await getDoc(doc(db, 'venues', id))
        if (!venueSnap.exists()) return null
        const data = venueSnap.data() as any
        if (data.deletedAt) return null // exclude soft-deleted venues
        return {
          id,
          name: data.name || 'Unnamed project',
          venueType: data.venueType || 'venue',
        }
      } catch {
        return null
      }
    })
  )
  return rows.filter((r): r is VenueRow => r !== null)
}

export default function ProjectsPage({
  user,
  activeVenueId,
  onOpenVenue,
}: {
  user: User
  activeVenueId: string | null
  onOpenVenue: (venue: VenueRow) => void
}) {
  const [venues, setVenues] = useState<VenueRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const autoSelected = useRef(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    loadVenues(user.uid)
      .then((rows) => {
        if (cancelled) return
        setVenues(rows)
        if (!autoSelected.current && rows.length === 1) {
          autoSelected.current = true
          onOpenVenue(rows[0])
        }
      })
      .catch((e) => !cancelled && setError(e?.message || 'Could not load projects.'))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.uid])

  return (
    <div>
      <h1 className={styles.heading}>My Projects</h1>
      <p className={styles.subhead}>
        {venues.length} project{venues.length !== 1 ? 's' : ''}
      </p>

      {loading && <p className={styles.loading}>Loading projects…</p>}
      {error && <p className={styles.error}>{error}</p>}

      {!loading && !error && venues.length === 0 && (
        <p className={styles.empty}>No projects yet. Create your first venue or festival from the mobile app.</p>
      )}

      {!loading && !error && venues.length > 0 && (
        <div className={styles.grid}>
          {venues.map((venue) => {
            const isActive = venue.id === activeVenueId
            return (
              <div key={venue.id} className={`${styles.card} ${isActive ? styles.cardActive : ''}`}>
                <div className={styles.cardTop}>
                  <h2 className={styles.cardName}>{venue.name}</h2>
                  <span className={`${styles.badge} ${venue.venueType === 'festival' ? styles.badgeFestival : ''}`}>
                    {venue.venueType === 'festival' ? 'Festival' : 'Venue'}
                  </span>
                </div>
                {isActive ? (
                  <span className={styles.activeLabel}>Active ✓</span>
                ) : (
                  <button type="button" className={styles.openButton} onClick={() => onOpenVenue(venue)}>
                    Open
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
