import { getAuth } from 'firebase/auth';
import { db } from './firebase';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import Constants from 'expo-constants';

const EXTRA: any =
  (Constants?.expoConfig?.extra as any) ??
  ((Constants as any)?.manifest2?.extra as any) ??
  {};

const DEV_VENUE = String(EXTRA.EXPO_PUBLIC_DEV_VENUE_ID || '');

export async function pinDevVenueIfEnvSet(): Promise<boolean> {
  const user = getAuth().currentUser;
  if (!user || !DEV_VENUE) return false;
  try {
    const uref = doc(db, 'users', user.uid);
    const usnap = await getDoc(uref);
    const current = usnap.exists() ? ((usnap.data() as any)?.venueId ?? null) : null;
    if (current) {
      console.log('[TallyUp DevBootstrap] dev pin skipped — already set', JSON.stringify({ uid: user.uid, venueId: current }));
      return true;
    }
    await updateDoc(uref, { venueId: DEV_VENUE, touchedAt: new Date() });
    console.log('[TallyUp DevBootstrap] pinned dev venue', JSON.stringify({ uid: user.uid, venueId: DEV_VENUE }));
    return true;
  } catch (e: any) {
    console.log('[TallyUp DevBootstrap] pin dev failed', JSON.stringify({ code: e?.code, message: e?.message }));
    return false;
  }
}

// Back-compat names expected elsewhere
export const _devBootstrap  = { pinDevVenueIfEnvSet };
export const _devBootstratp = _devBootstrap;
