import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { DEV_EMAIL, DEV_PASSWORD } from './dev';
import { pinDevVenueIfEnvSet, ensureDevMembership } from '../services/devBootstrap';

/**
 * Dev login:
 * - Sign in with DEV_EMAIL/DEV_PASSWORD
 * - If EXPO_PUBLIC_DEV_VENUE_ID is set, pin users/{uid}.venueId to that venue
 * - Ensure venues/{venueId}/members/{uid} exists
 */
export async function devLogin() {
  const auth = getAuth();
  const { user } = await signInWithEmailAndPassword(auth, DEV_EMAIL, DEV_PASSWORD);
  const uid = user.uid;

  const pin = await pinDevVenueIfEnvSet(); // { venueId } or null
  if (pin?.venueId) {
    await ensureDevMembership(); // add/repair membership doc
  }
  return { uid, venueId: pin?.venueId ?? null };
}
