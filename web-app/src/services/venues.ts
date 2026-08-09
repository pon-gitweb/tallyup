/**
 * web-app/src/services/venues.ts
 *
 * Mirrors mobile's src/services/venues.ts (createVenueOwnedByCurrentUser) and
 * src/services/onboarding/defaultDepartments.ts (seedDefaultDepartmentsAndAreas).
 *
 * The createVenueOwnedByUser Cloud Function is deployed to australia-southeast1
 * (confirmed from functions/src/createVenueOwnedByUser.ts and the mobile BASE_URL).
 *
 * IMPORTANT: The Cloud Function sets users/{uid}.venueId (singular) but NOT the
 * venueIds array that web-app's loadVenues reads. We update venueIds client-side
 * with arrayUnion immediately after the CF call — fire-and-forget, non-fatal.
 *
 * The Cloud Function does NOT seed departments. Seeding is client-side only,
 * matching mobile's CreateVenueScreen.tsx exactly.
 */

import { getAuth } from 'firebase/auth'
import {
  doc,
  updateDoc,
  arrayUnion,
  collection,
  getDocs,
  query,
  limit,
  writeBatch,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '../firebase'

const BASE_URL = 'https://australia-southeast1-tallyup-f1463.cloudfunctions.net'

// ─── Venue creation ───────────────────────────────────────────────────────────

/**
 * Call the Cloud Function to create a new venue, then sync the returned venueId
 * into users/{uid}.venueIds so loadVenues can find it.
 *
 * Mirrors mobile's createVenueOwnedByCurrentUser — same endpoint, same auth
 * (getIdToken + Bearer), same error handling, same response parsing.
 *
 * Returns the new venueId string.
 */
export async function createVenue(name: string): Promise<string> {
  const auth = getAuth()
  const user = auth.currentUser
  if (!user) throw new Error('Not signed in. Please log in before creating a venue.')

  const trimmedName = (name || '').trim()
  if (!trimmedName) throw new Error('Venue name is required.')

  let idToken: string
  try {
    idToken = await user.getIdToken()
  } catch (err: any) {
    console.warn('[createVenue] getIdToken error', err?.message)
    throw new Error('Could not obtain auth token. Please try signing in again.')
  }

  let res: Response
  try {
    res = await fetch(`${BASE_URL}/createVenueOwnedByUser`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`,
      },
      body: JSON.stringify({ name: trimmedName }),
    })
  } catch (err: any) {
    console.warn('[createVenue] network error', err?.message)
    throw new Error('Failed to reach the server. Check your connection and try again.')
  }

  if (!res.ok) {
    let bodyText: string | undefined
    try { bodyText = await res.text() } catch { /* ignore */ }

    if (res.status === 401 || res.status === 403) {
      throw new Error('You are not authorised to create a venue. Please sign in again and try once more.')
    }

    // Surface structured JSON error if the backend sent one
    let surfacedError: string | undefined
    try {
      const j = bodyText ? JSON.parse(bodyText) : null
      if (j && typeof j.error === 'string') surfacedError = j.error
    } catch { /* ignore — bodyText may not be JSON */ }

    console.warn('[createVenue] HTTP error', res.status, bodyText)
    throw new Error(surfacedError ?? bodyText ?? `Server error (${res.status})`)
  }

  let json: any = null
  try { json = await res.json() } catch {
    console.warn('[createVenue] response not JSON')
  }

  const venueId = json?.venueId
  if (!venueId || typeof venueId !== 'string') {
    console.warn('[createVenue] missing venueId in response', json)
    throw new Error('Server did not return a venue id.')
  }

  console.log('[createVenue] success', { venueId })

  // The Cloud Function only sets users/{uid}.venueId (singular). loadVenues reads
  // venueIds (array). Write the arrayUnion client-side so My Projects shows the
  // new venue. Fire-and-forget — failure is non-fatal; user is routed directly via
  // onOpenVenue regardless.
  updateDoc(doc(db, 'users', user.uid), {
    venueIds: arrayUnion(venueId),
  }).catch((err: any) =>
    console.warn('[createVenue] venueIds arrayUnion failed:', err?.message)
  )

  return venueId
}

// ─── Default department seeding ───────────────────────────────────────────────
// Port of src/services/onboarding/defaultDepartments.ts — same data, same logic,
// using web-app's db instead of mobile's. Called client-side after venue creation,
// non-fatally (try/catch in caller), exactly matching CreateVenueScreen.tsx.

type DefaultArea = { name: string; order: number }
type DefaultDepartment = { id: string; name: string; order: number; areas: DefaultArea[] }

const DEFAULT_DEPARTMENTS: DefaultDepartment[] = [
  {
    id: 'bar',
    name: 'Bar',
    order: 1,
    areas: [
      { name: 'Front Bar', order: 1 },
      { name: 'Back Bar', order: 2 },
      { name: 'Bottle Chiller', order: 3 },
      { name: 'Beer Tap Bay', order: 4 },
    ],
  },
  {
    id: 'kitchen',
    name: 'Kitchen',
    order: 2,
    areas: [
      { name: 'Dry Store', order: 1 },
      { name: 'Walk-in Chiller', order: 2 },
      { name: 'Freezer', order: 3 },
      { name: 'Prep Bench', order: 4 },
    ],
  },
  {
    id: 'bottleshop',
    name: 'Bottle Store',
    order: 3,
    areas: [
      { name: 'Wine Rack', order: 1 },
      { name: 'Spirits Wall', order: 2 },
      { name: 'Beer Fridge', order: 3 },
    ],
  },
  {
    id: 'lounge',
    name: 'Lounge / Restaurant',
    order: 4,
    areas: [
      { name: 'Service Bar', order: 1 },
      { name: 'Floor Fridge', order: 2 },
      { name: 'Feature Shelf', order: 3 },
    ],
  },
]

/**
 * Seed default departments + areas for a new venue.
 * Mirrors mobile's seedDefaultDepartmentsAndAreas exactly:
 *   - No-ops if departments already exist (idempotent).
 *   - Writes venues/{venueId}/departments/{id} and their areas/{autoId}.
 */
export async function seedDefaultDepartments(venueId: string): Promise<{ created: number }> {
  if (!venueId) throw new Error('seedDefaultDepartments: missing venueId')

  const deptCol = collection(db, 'venues', venueId, 'departments')

  // Idempotency guard — skip if any departments already exist.
  const existing = await getDocs(query(deptCol, limit(1)))
  if (!existing.empty) return { created: 0 }

  const batch = writeBatch(db)
  const now = serverTimestamp()
  let created = 0

  for (const dept of DEFAULT_DEPARTMENTS) {
    const deptRef = doc(deptCol, dept.id)
    batch.set(deptRef, { name: dept.name, order: dept.order, createdAt: now, updatedAt: now })

    const areasCol = collection(deptRef, 'areas')
    for (const area of dept.areas) {
      const areaRef = doc(areasCol) // auto-id
      batch.set(areaRef, {
        name: area.name,
        order: area.order,
        createdAt: now,
        updatedAt: now,
        startedAt: null,
        completedAt: null,
        lockedByUid: null,
        lockedByName: null,
        lockedAt: null,
        currentLock: null,
      })
      created += 1
    }
  }

  await batch.commit()
  return { created }
}
