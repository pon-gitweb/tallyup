import '../polyfills/firestorePaths'
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, getAuth, User } from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { db } from '../services/firebase';
import {
  doc, collection, onSnapshot, getDoc, getDocs, setDoc, updateDoc,
  query, where, limit as qlimit, Unsubscribe, serverTimestamp,
} from 'firebase/firestore';
import { DEV_VENUE_ID, IS_DEV_PIN_ENABLED, isDevEmail } from '../config/dev';
import { BillingState, defaultBillingState } from '../services/billing/entitlements';
import { MODULES } from '../services/billing/modules';

export type SubscriptionData = {
  status: string;
  plan: string | null;
  modules: string[];
  currentPeriodEnd: string | null;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
};

type VenueCtx = {
  loading: boolean;
  user: User | null;
  venueId: string | null;
  activeVenueId: string | null;
  venueIds: string[];
  venueType: string | null;
  venueCountry: string;
  switchVenue: (newVenueId: string) => Promise<void>;
  refresh: () => void;
  attachVenueIfMissing: () => Promise<void>;
  subscription: SubscriptionData | null;
  isPilot: boolean;
  isActive: boolean;
  plan: string | null;
  hasModule: (moduleId: string) => boolean;
  billingState: BillingState;
};

const Ctx = createContext<VenueCtx>({
  loading: true, user: null, venueId: null, activeVenueId: null, venueIds: [], venueType: null, venueCountry: 'NZ',
  switchVenue: async () => {},
  refresh: () => {}, attachVenueIfMissing: async () => {},
  subscription: null, isPilot: true, isActive: false, plan: null, hasModule: () => false,
  billingState: defaultBillingState,
});

export function VenueProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [venueId, setVenueId] = useState<string | null>(null);
  const [venueIds, setVenueIds] = useState<string[]>([]);
  const [nonce, setNonce] = useState(0);
  const [subscription, setSubscription] = useState<SubscriptionData | null>(null);
  const [venueType, setVenueType] = useState<string | null>(null);
  const [venueCountry, setVenueCountry] = useState<string>('NZ');

  const triedAutoAttachForUid = useRef<string | null>(null);
  const lastVenueIdRef = useRef<string | null>(undefined as any);
  const unsubUserDocRef = useRef<Unsubscribe | null>(null);
  const unsubVenueDocRef = useRef<Unsubscribe | null>(null);
  const userSnapshotFailsafeRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearUserSnapshotFailsafe() {
    if (userSnapshotFailsafeRef.current) {
      clearTimeout(userSnapshotFailsafeRef.current);
      userSnapshotFailsafeRef.current = null;
    }
  }

  useEffect(() => {
    if (__DEV__) console.log('[TallyUp VenueProvider] mount');
    const auth = getAuth();

    if (unsubUserDocRef.current) { unsubUserDocRef.current(); unsubUserDocRef.current = null; }
    triedAutoAttachForUid.current = null;
    setVenueId(null);
    setLoading(true);

    const unsubAuth = onAuthStateChanged(auth, async (u) => {
      if (__DEV__) console.log('[TallyUp VenueProvider] auth', JSON.stringify({ uid: u?.uid ?? null }));
      setUser(u || null);
      setVenueId(null);

      if (!u) {
        setLoading(false);
        clearUserSnapshotFailsafe();
        if (unsubUserDocRef.current) { unsubUserDocRef.current(); unsubUserDocRef.current = null; }
        return;
      }

      // Only skip venue loading for new accounts that require email verification.
      // Existing users (no flag) proceed with normal bootstrap.
      if (!u.emailVerified) {
        try {
          const userSnap = await getDoc(doc(db, 'users', u.uid));
          const requiresVerification = userSnap.data()?.requiresEmailVerification === true;
          if (requiresVerification) {
            // New unverified account — skip venue bootstrap
            setUser(u);
            setLoading(false);
            return;
          }
          // Existing user without flag — proceed with normal bootstrap
        } catch (e) {
          // Doc read failed — proceed anyway, don't block existing users
          console.warn('[VenueProvider] flag check failed:', e);
        }
      }

      // Ensure users/{uid} exists — bounded so a hung getDoc/setDoc can't block
      // bootstrap (and thus `loading`) forever on a bad connection.
      const BOOTSTRAP_TIMEOUT = 8000;
      try {
        const uref = doc(db, 'users', u.uid);
        await Promise.race([
          (async () => {
            const usnap = await getDoc(uref);
            if (!usnap.exists()) {
              await setDoc(uref, { createdAt: new Date(), email: u.email ?? null }, { merge: true });
              if (__DEV__) console.log('[TallyUp VenueProvider] created users doc', JSON.stringify({ uid: u.uid }));
            }
          })(),
          new Promise<void>((_, reject) =>
            setTimeout(() => reject(new Error('bootstrap-timeout')), BOOTSTRAP_TIMEOUT)
          ),
        ]);
      } catch (e: any) {
        if (__DEV__) console.log('[TallyUp VenueProvider] ensure user doc error', JSON.stringify({ code: e?.code, message: e?.message }));
      }

      const uref = doc(db, 'users', u.uid);

      // Failsafe — if the first user-doc snapshot never arrives (e.g. a
      // dead connection that never invokes the error callback either),
      // `loading` would otherwise stay true forever. Bound it to 10s.
      clearUserSnapshotFailsafe();
      userSnapshotFailsafeRef.current = setTimeout(() => {
        userSnapshotFailsafeRef.current = null;
        if (__DEV__) console.warn('[TallyUp VenueProvider] user snapshot timeout — proceeding without user data');
        setLoading(false);
      }, 10000);

      unsubUserDocRef.current = onSnapshot(uref, async (snap) => {
        clearUserSnapshotFailsafe();
        const data = snap.exists() ? (snap.data() as any) : null;
        const currentVenue: string | null = data?.activeVenueId ?? data?.venueId ?? null;
        const currentVenueIds: string[] = data?.venueIds ?? (data?.venueId ? [data.venueId] : []);
        if (__DEV__) console.log('[TallyUp VenueProvider] user snapshot', JSON.stringify({ uid: u.uid, venueId: currentVenue ?? null, venueIds: currentVenueIds }));

        // Auto-select first venue if user has venues but no active one set (once per uid).
        // Skips soft-deleted venues (deletedAt set) — those only surface in the
        // "Recently deleted" recovery section, never as the active venue.
        if (!currentVenue && currentVenueIds.length > 0 && triedAutoAttachForUid.current !== u.uid) {
          triedAutoAttachForUid.current = u.uid;
          try {
            let nextVenueId: string | null = null;
            for (const candidateId of currentVenueIds) {
              const candidateSnap = await getDoc(doc(db, 'venues', candidateId));
              if (candidateSnap.exists() && !candidateSnap.data()?.deletedAt) {
                nextVenueId = candidateId;
                break;
              }
            }
            if (nextVenueId) {
              await updateDoc(doc(db, 'users', u.uid), { activeVenueId: nextVenueId, touchedAt: new Date() });
              return; // onSnapshot will fire again with updated data
            }
          } catch {}
        }

        if (lastVenueIdRef.current !== currentVenue) {
          lastVenueIdRef.current = currentVenue;
          setVenueId(currentVenue ?? null);
        }
        setVenueIds(currentVenueIds);
        setLoading(false);

        if ((currentVenue === null || currentVenue === undefined) && triedAutoAttachForUid.current !== u.uid) {
          triedAutoAttachForUid.current = u.uid;
          await attemptAutoAttach(u);
        }
      }, (err) => {
        clearUserSnapshotFailsafe();
        if (__DEV__) console.log('[TallyUp VenueProvider] user snapshot error', JSON.stringify({ code: err?.code, message: err?.message }));
        setVenueId(null);
        setLoading(false);
      });
    });

    return () => {
      unsubAuth();
      clearUserSnapshotFailsafe();
      if (unsubUserDocRef.current) { unsubUserDocRef.current(); unsubUserDocRef.current = null; }
    };
  }, [nonce]);

  useEffect(() => {
    if (unsubVenueDocRef.current) { unsubVenueDocRef.current(); unsubVenueDocRef.current = null; }
    if (!venueId) { setSubscription(null); setVenueType(null); setVenueCountry('NZ'); return; }
    unsubVenueDocRef.current = onSnapshot(doc(db, 'venues', venueId), (snap) => {
      if (!snap.exists()) {
        // Venue doc not yet written — keep loading, don't flip to null/festival
        return;
      }
      const data = snap.data();
      // Default to 'venue' so null/undefined venueType never triggers festival routing
      const vt = (data?.venueType as string) || 'venue';
      setVenueType(vt);
      AsyncStorage.setItem('lastKnownVenueType', vt).catch(() => {});
      // Default to 'NZ' so venues with no country set keep today's 15% GST behaviour
      setVenueCountry((data?.country as string) || 'NZ');
      const sub = data?.subscription ?? null;
      setSubscription(sub ? {
        status: sub.status || 'pilot',
        plan: sub.plan ?? null,
        modules: Array.isArray(sub.modules) ? sub.modules : [],
        currentPeriodEnd: sub.currentPeriodEnd ?? null,
        stripeCustomerId: sub.stripeCustomerId,
        stripeSubscriptionId: sub.stripeSubscriptionId,
      } : null);
    }, (err) => {
      if (__DEV__) console.log('[TallyUp VenueProvider] venue snapshot error', JSON.stringify({ code: err?.code, message: err?.message }));
      // Only clear state on permanent errors — not transient network issues
      if (err?.code === 'permission-denied') {
        // User has been removed from this venue — clear context so HomeRouter can redirect
        setVenueId(null);
        setSubscription(null);
        setVenueType(null);
        setVenueCountry('NZ');
      }
      // For transient errors (unavailable, network, etc.) — leave existing state intact
      // Firebase will automatically retry the snapshot when the connection recovers
    });
    return () => {
      if (unsubVenueDocRef.current) { unsubVenueDocRef.current(); unsubVenueDocRef.current = null; }
    };
  }, [venueId]);

  const isPilot = !subscription || !['active', 'trialing'].includes(subscription.status);
  const isActive = subscription?.status === 'active' || subscription?.status === 'trialing';
  const plan = subscription?.plan ?? null;
  const hasModule = (moduleId: string) => subscription?.modules?.includes(moduleId) ?? false;

  // Maps SubscriptionData → BillingState so guards and components have one source of truth.
  // During pilot isPilot=true → accessMode='full' for all venues regardless of Stripe.
  const billingState: BillingState = {
    plan: isActive ? ((subscription?.plan as 'core' | 'core_plus') ?? 'core') : 'none',
    addons: {
      aiReporting: isPilot || (subscription?.modules?.includes(MODULES.OPS_INTELLIGENCE) ?? false),
      predictiveOrdering: isPilot || (subscription?.modules?.includes(MODULES.SUPPLIER_OPTIMISATION) ?? false),
      gamification: isPilot || (subscription?.modules?.includes(MODULES.PERFORMANCE_INCENTIVES) ?? false),
      suitee: isPilot || (subscription?.modules?.includes(MODULES.OPS_INTELLIGENCE) ?? false),
      groupHQ: isPilot || (subscription?.modules?.includes(MODULES.MULTI_VENUE) ?? false),
    },
    accessMode: isPilot || isActive ? 'full' : 'readOnly',
    trial: {},
  };

  const value = useMemo(() => ({
    loading,
    user,
    venueId,
    activeVenueId: venueId,
    venueIds,
    venueType,
    venueCountry,
    switchVenue: async (newVenueId: string) => {
      if (!user) throw new Error('Not signed in');
      const memberSnap = await getDoc(doc(db, 'venues', newVenueId, 'members', user.uid));
      if (!memberSnap.exists()) throw new Error('Not a member of this venue');
      // Fetch new venue's type immediately so UI updates before onSnapshot fires
      const venueSnap = await getDoc(doc(db, 'venues', newVenueId));
      const newType = (venueSnap.data()?.venueType as string) || 'venue';
      const newCountry = (venueSnap.data()?.country as string) || 'NZ';
      setVenueType(newType);
      setVenueCountry(newCountry);
      // Then write to Firestore — onSnapshot will confirm/reconcile
      await updateDoc(doc(db, 'users', user.uid), {
        activeVenueId: newVenueId,
        touchedAt: serverTimestamp(),
      });
    },
    refresh: () => setNonce(n => n + 1),
    attachVenueIfMissing: async () => { if (user) await attemptAutoAttach(user); },
    subscription,
    isPilot,
    isActive,
    plan,
    hasModule,
    billingState,
  }), [loading, user, venueId, venueIds, venueType, venueCountry, subscription, isPilot, isActive, plan]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;

  /** ---------- helpers ---------- */

  async function attemptAutoAttach(u: User) {
    try {
      const email = u.email ?? null;
      const uid = u.uid;
      const devAccount = IS_DEV_PIN_ENABLED && isDevEmail(email);
      if (__DEV__) console.log('[TallyUp VenueProvider] auto-attach begin', JSON.stringify({ uid, email, devAccount, IS_DEV_PIN_ENABLED }));

      // Only dev accounts may be auto-attached to DEV_VENUE_ID
      if (devAccount && DEV_VENUE_ID) {
        const okDev = await trySetVenueId(uid, DEV_VENUE_ID);
        if (okDev) return;
      }

      // No other auto-attach (owned/membership scans are noisy under rules and not necessary).
      if (__DEV__) console.log('[TallyUp VenueProvider] auto-attach: no action taken', JSON.stringify({ uid }));
    } catch (e: any) {
      if (__DEV__) console.log('[TallyUp VenueProvider] auto-attach fatal', JSON.stringify({ code: e?.code, message: e?.message }));
    }
  }

  async function trySetVenueId(uid: string, venue: string): Promise<boolean> {
    try {
      const uref = doc(db, 'users', uid);
      const usnap = await getDoc(uref);
      const current = usnap.exists() ? (usnap.data() as any)?.venueId ?? null : null;
      if (current) {
        if (__DEV__) console.log('[TallyUp VenueProvider] auto-attach skipped — already set', JSON.stringify({ uid, venueId: current }));
        return true;
      }
      await updateDoc(uref, { venueId: venue, touchedAt: new Date() });
      if (__DEV__) console.log('[TallyUp VenueProvider] auto-attached venue', JSON.stringify({ uid, venueId: venue }));
      return true;
    } catch (e: any) {
      if (__DEV__) console.log('[TallyUp VenueProvider] set venueId failed', JSON.stringify({ code: e?.code, message: e?.message, uid, venue }));
      return false;
    }
  }
}

export function useVenue() { return useContext(Ctx); }
export function useVenueId(): string | null { return useContext(Ctx).venueId; }
export function useVenueType(): string | null { return useContext(Ctx).venueType; }
export function useVenueCountry(): string { return useContext(Ctx).venueCountry; }
export function useSubscription() {
  const { subscription, isPilot, isActive, plan, hasModule, billingState } = useContext(Ctx);
  return { subscription, isPilot, isActive, plan, hasModule, billingState };
}
