import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, getAuth, User } from 'firebase/auth';
import { db } from '../services/firebase';
import {
  doc, collection, onSnapshot, getDoc, getDocs, setDoc, updateDoc,
  query, where, limit as qlimit, Unsubscribe,
} from 'firebase/firestore';
import Constants from 'expo-constants';

type VenueCtx = {
  loading: boolean;
  user: User | null;
  venueId: string | null;
  refresh: () => void;
  attachVenueIfMissing: () => Promise<void>;
};

const Ctx = createContext<VenueCtx>({
  loading: true, user: null, venueId: null, refresh: () => {}, attachVenueIfMissing: async () => {},
});

const EXTRA: any =
  (Constants?.expoConfig?.extra as any) ??
  ((Constants as any)?.manifest2?.extra as any) ??
  {};
const DEV_PIN = (EXTRA.EXPO_PUBLIC_DEV_VENUE_ID as string) || null;

export function VenueProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [venueId, setVenueId] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const triedAutoAttachForUid = useRef<string | null>(null);
  const unsubUserDocRef = useRef<Unsubscribe | null>(null);

  useEffect(() => {
    console.log('[TallyUp VenueProvider] mount');
    const auth = getAuth();

    if (unsubUserDocRef.current) { unsubUserDocRef.current(); unsubUserDocRef.current = null; }
    triedAutoAttachForUid.current = null;
    setVenueId(null);
    setLoading(true);

    const unsubAuth = onAuthStateChanged(auth, async (u) => {
      console.log('[TallyUp VenueProvider] auth', JSON.stringify({ uid: u?.uid ?? null }));
      setUser(u || null);
      setVenueId(null);

      if (!u) {
        setLoading(false);
        if (unsubUserDocRef.current) { unsubUserDocRef.current(); unsubUserDocRef.current = null; }
        return;
      }

      // Ensure users/{uid} exists
      try {
        const uref = doc(db, 'users', u.uid);
        const usnap = await getDoc(uref);
        if (!usnap.exists()) {
          await setDoc(uref, { createdAt: new Date(), email: u.email ?? null }, { merge: true });
          console.log('[TallyUp VenueProvider] created users doc', JSON.stringify({ uid: u.uid }));
        }
      } catch (e: any) {
        console.log('[TallyUp VenueProvider] ensure user doc error', JSON.stringify({ code: e?.code, message: e?.message }));
      }

      const uref = doc(db, 'users', u.uid);
      unsubUserDocRef.current = onSnapshot(uref, async (snap) => {
        const currentVenue = snap.exists() ? (snap.data() as any)?.venueId ?? null : null;
        console.log('[TallyUp VenueProvider] user snapshot', JSON.stringify({ uid: u.uid, venueId: currentVenue ?? null }));
        setVenueId(currentVenue ?? null);
        setLoading(false);

        if ((currentVenue === null || currentVenue === undefined) && triedAutoAttachForUid.current !== u.uid) {
          triedAutoAttachForUid.current = u.uid;
          await attemptAutoAttach(u.uid);
        }
      }, (err) => {
        console.log('[TallyUp VenueProvider] user snapshot error', JSON.stringify({ code: err?.code, message: err?.message }));
        setVenueId(null);
        setLoading(false);
      });
    });

    return () => {
      unsubAuth();
      if (unsubUserDocRef.current) { unsubUserDocRef.current(); unsubUserDocRef.current = null; }
    };
  }, [nonce]);

  const value = useMemo(() => ({
    loading,
    user,
    venueId,
    refresh: () => setNonce(n => n + 1),
    attachVenueIfMissing: async () => { if (user) await attemptAutoAttach(user.uid, true); },
  }), [loading, user, venueId]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;

  /** ---------- helpers ---------- */

  async function attemptAutoAttach(uid: string, force = false) {
    try {
      console.log('[TallyUp VenueProvider] auto-attach begin', JSON.stringify({ uid, force, DEV_PIN: !!DEV_PIN }));

      // (0) DEV PIN shortcut — safest path in dev
      if (DEV_PIN) {
        const okDev = await trySetVenueId(uid, DEV_PIN);
        if (okDev) return;
      }

      // (A) Owned venue (may be blocked by rules — just try once)
      try {
        const ownQ = query(collection(db, 'venues'), where('ownerUid', '==', uid), qlimit(1));
        const ownSnap = await getDocs(ownQ);
        console.log('[TallyUp VenueProvider] owned query', JSON.stringify({ count: ownSnap.size }));
        if (!ownSnap.empty) {
          const ownedId = ownSnap.docs[0].id;
          const ok = await trySetVenueId(uid, ownedId);
          if (ok) return;
        }
      } catch (e: any) {
        console.log('[TallyUp VenueProvider] owned query error', JSON.stringify({ code: e?.code, message: e?.message }));
      }

      // (B) Membership scan — intentionally skipped to avoid invalid-argument spam across SDKs.
      console.log('[TallyUp VenueProvider] membership scan skipped (collectionGroup(documentId) not portable).');

      // Fallback: do nothing — user can Create / Attach via Setup or Dashboard action.
      console.log('[TallyUp VenueProvider] auto-attach: no action taken', JSON.stringify({ uid }));
    } catch (e: any) {
      console.log('[TallyUp VenueProvider] auto-attach fatal', JSON.stringify({ code: e?.code, message: e?.message }));
    }
  }

  async function trySetVenueId(uid: string, venue: string): Promise<boolean> {
    try {
      const uref = doc(db, 'users', uid);
      const usnap = await getDoc(uref);
      const current = usnap.exists() ? (usnap.data() as any)?.venueId ?? null : null;
      if (current) {
        console.log('[TallyUp VenueProvider] auto-attach skipped — already set', JSON.stringify({ uid, venueId: current }));
        return true;
      }
      await updateDoc(uref, { venueId: venue, touchedAt: new Date() });
      console.log('[TallyUp VenueProvider] auto-attached venue', JSON.stringify({ uid, venueId: venue }));
      return true;
    } catch (e: any) {
      console.log('[TallyUp VenueProvider] set venueId failed', JSON.stringify({ code: e?.code, message: e?.message, uid, venue }));
      return false;
    }
  }
}

export function useVenue() { return useContext(Ctx); }
export function useVenueId(): string | null { return useContext(Ctx).venueId; }
