import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';

/**
 * Returns true if the venue's active festival event is closed.
 *
 * Fails open (returns false) on any read error or missing document — a
 * transient Firestore failure should never block legitimate activity. This
 * is a safety-net guard (D-050), not a security boundary.
 */
export async function isFestivalEventClosed(venueId: string): Promise<boolean> {
  try {
    const snap = await getDoc(doc(db, 'venues', venueId, 'event', 'details'));
    return snap.exists() && snap.data()?.status === 'closed';
  } catch {
    // Fail open — don't block writes on transient read failure
    return false;
  }
}
