import { getAuth } from 'firebase/auth';
import { doc, getDoc, getFirestore } from 'firebase/firestore';

export async function debugVenueRole(venueId: string) {
  const auth = getAuth();
  const user = auth.currentUser;
  if (!venueId || !user) throw new Error('No venue or user');
  const db = getFirestore();
  const snap = await getDoc(doc(db, 'venues', venueId, 'members', user.uid));
  const memberRole = snap.exists() ? (snap.data() as any)?.role : null;
  const token = await user.getIdTokenResult();
  const tokenRole =
    (token?.claims?.venue_roles && (token.claims.venue_roles as any)[venueId]) || null;
  return { uid: user.uid, venueId, memberRole, tokenRole };
}
