import { db } from './firebase';
import { doc, getDoc, collection, getDocs, limit, query } from 'firebase/firestore';

export async function checkVenueAccess(venueId: string, uid: string) {
  const results: Record<string, any> = {};

  // Step A: venue doc
  try {
    const v = await getDoc(doc(db, 'venues', venueId));
    results.venue = v.exists() ? 'ok' : 'missing';
  } catch (e: any) {
    results.venue = `error: ${e?.code || e?.message}`;
  }

  // Step B: member doc
  try {
    const m = await getDoc(doc(db, 'venues', venueId, 'members', uid));
    results.member = m.exists() ? m.data() : 'missing';
  } catch (e: any) {
    results.member = `error: ${e?.code || e?.message}`;
  }

  // Step C: departments under venue (NOT a collectionGroup)
  try {
    const depCol = collection(db, 'venues', venueId, 'departments');
    const depSnap = await getDocs(query(depCol, limit(1)));
    results.departments = depSnap.size > 0 ? 'ok' : 'empty';
  } catch (e: any) {
    results.departments = `error: ${e?.code || e?.message}`;
  }

  return results;
}
