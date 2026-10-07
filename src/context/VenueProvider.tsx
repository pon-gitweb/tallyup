import '../polyfills/firestorePaths'
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, getAuth, User } from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { db } from '../services/firebase';
import {
  doc, collection, onSnapshot, getDoc, getDocs, setDoc, updateDoc,
  query, where, limit as qlimit, Unsubscribe, serverTimestamp, runTransaction,
} from 'firebase/firestore';
import { DEV_VENUE_ID, IS_DEV_PIN_ENABLED, isDevEmail } from '../config/dev';
import { BillingState, defaultBillingState } from '../services/billing/entitlements';
import { MODULE_INTRODUCED_AT } from '../services/billing/modules';
import { resolveEntitlements } from '../services/billing/resolveEntitlements';

export type TrialStateDoc = {
  startedAt: { toMillis: () => number } | null;
  stocktakesAtStart: number;
  stocktakesUsed: number;
  status: 'active' | 'converting' | 'expired';
  resolvedAt?: any;
  resolvedReason?: string;
  reminderSentAt?: any;
};

type ModuleTrialEntry = {
  startedAt: any;
  expiresAt: { toMillis?: () => number; getTime?: () => number } | null;
  status: 'active' | 'expired' | 'converted';
};


export type SubscriptionData = {
  status: string;
  plan: string | null;
  modules: string[];
  currentPeriodEnd: string | null;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
};

// Manual entitlement bypass — set via Firebase Console or Admin SDK only.
// Never written by any client; see firestore.rules comment for security boundary.
export type SubscriptionOverride = {
  plan: 'core' | 'core_plus';
  modules: string[];
};

type VenueCtx = {
  loading: boolean;
  user: User | null;
  venueId: string | null;
  activeVenueId: string | null;
  venueIds: string[];
  venueType: string | null;
  venueCountry: string;
  initVenue: (newVenueId: string, newVenueType: string, newVenueCountry: string) => void;
  switchVenue: (newVenueId: string) => Promise<void>;
  refresh: () => void;
  attachVenueIfMissing: () => Promise<void>;
  subscription: SubscriptionData | null;
  subscriptionOverride: SubscriptionOverride | null;
  isPilot: boolean;
  isActive: boolean;
  plan: string | null;
  hasModule: (moduleId: string) => boolean;
  billingState: BillingState;
  discountPercent: number; // 0 = no discount; 50 = 50% off Core (Matchbox/pilot period)
  ready: boolean; // false while any entitlement input is still loading
  /** true only when the config/billing doc explicitly sets enforceReadOnly=true */
  enforceReadOnly: boolean;
  /** mirrors venue.stocktakeActive — true while a stocktake cycle is in progress */
  stocktakeActive: boolean;
  trialState: TrialStateDoc | null | undefined;
};

const Ctx = createContext<VenueCtx>({
  loading: true, user: null, venueId: null, activeVenueId: null, venueIds: [], venueType: null, venueCountry: 'NZ',
  initVenue: () => {},
  switchVenue: async () => {},
  refresh: () => {}, attachVenueIfMissing: async () => {},
  subscription: null, subscriptionOverride: null, isPilot: true, isActive: false, plan: null, hasModule: () => false,
  billingState: defaultBillingState, discountPercent: 0, ready: false, enforceReadOnly: false, stocktakeActive: false,
  trialState: undefined,
});

export function VenueProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [venueId, setVenueId] = useState<string | null>(null);
  const [venueIds, setVenueIds] = useState<string[]>([]);
  const [nonce, setNonce] = useState(0);
  const [subscription, setSubscription] = useState<SubscriptionData | null>(null);
  const [subscriptionOverride, setSubscriptionOverride] = useState<SubscriptionOverride | null>(null);
  const [legacyFreeAccess, setLegacyFreeAccess] = useState(false);
  const [ownerUid, setOwnerUid] = useState<string | null>(null);
  const [venueCreatedAt, setVenueCreatedAt] = useState<Date | null>(null);
  const [pilotTriggerDate, setPilotTriggerDate] = useState<Date | null>(null);
  const [venueType, setVenueType] = useState<string | null>(null);
  const [venueCountry, setVenueCountry] = useState<string>('NZ');
  // undefined = snapshot not yet fired (loading); null = doc doesn't exist; object = loaded
  const [trialState, setTrialState] = useState<TrialStateDoc | null | undefined>(undefined);
  const [moduleTrialState, setModuleTrialState] = useState<Record<string, ModuleTrialEntry> | null>(null);
  // Records which venueId the venue-doc snapshot (subscription, venueType, etc.) belongs to.
  // null until the first snapshot for the CURRENT venueId fires. Prevents stale state from
  // a previously-active venue from being evaluated while loading the new venue.
  const [venueDocVenueId, setVenueDocVenueId] = useState<string | null>(null);
  // Master enforcement switch — off by default; on only when config/billing sets it true.
  const [enforceReadOnly, setEnforceReadOnly] = useState(false);
  // true while venue.stocktakeActive is set on the venue doc (a cycle is in progress).
  const [stocktakeActive, setStocktakeActive] = useState(false);

  const triedAutoAttachForUid = useRef<string | null>(null);
  const lastVenueIdRef = useRef<string | null>(undefined as any);
  const lastVenueTypeRef = useRef<string | null>(null);
  const unsubUserDocRef = useRef<Unsubscribe | null>(null);
  const unsubVenueDocRef = useRef<Unsubscribe | null>(null);
  const userSnapshotFailsafeRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks which venueId we've already attempted trial init for — prevents
  // double-write across React Strict Mode double-invoke or rapid re-renders.

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
          // Only downgrade to null if we're certain the user has no venue:
          // - currentVenue is null AND
          // - user has no venueIds at all (not just no active one)
          // This prevents network flickers or intermediate Firestore states from
          // clearing the venue while the user is actively using the app.
          const shouldClearVenue = currentVenue === null && currentVenueIds.length === 0;
          const nextVenueId = currentVenue ?? (shouldClearVenue ? null : lastVenueIdRef.current);

          lastVenueIdRef.current = currentVenue; // track what Firestore says
          setVenueId(nextVenueId);              // but hold existing venueId if user still has venues

          if (currentVenue) {
            AsyncStorage.setItem('lastKnownVenueId', currentVenue).catch(() => {});
          }
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
        // Only clear venueId on permanent errors — transient errors should self-heal
        if (err?.code === 'permission-denied') {
          setVenueId(null);
        }
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
    // Reset per-venue state so stale data from the previous venue is never evaluated.
    setVenueDocVenueId(null);
    lastVenueTypeRef.current = null; // never inherit venueType across venue boundaries
    if (unsubVenueDocRef.current) { unsubVenueDocRef.current(); unsubVenueDocRef.current = null; }
    if (!venueId) { setSubscription(null); setSubscriptionOverride(null); setLegacyFreeAccess(false); setOwnerUid(null); setVenueCreatedAt(null); setVenueType(null); setVenueCountry('NZ'); setStocktakeActive(false); return; }
    unsubVenueDocRef.current = onSnapshot(doc(db, 'venues', venueId), (snap) => {
      if (!snap.exists()) {
        // Venue doc not yet written — keep loading, don't flip to null/festival
        return;
      }
      const data = snap.data();
      // Mark venue-doc snapshot as belonging to the current venueId so resolveEntitlements
      // and useWriteGuard know the data is for the venue currently being viewed.
      setVenueDocVenueId(venueId);
      setStocktakeActive(data?.stocktakeActive === true);
      // The venue doc updates for reasons unrelated to venueType too (e.g.
      // totalStocktakesCompleted incrementing after a stocktake). Only adopt a new
      // venueType when this snapshot actually carries one — never overwrite a known
      // type with a missing/falsy value, which would otherwise re-trigger routing.
      const newVenueType = (data?.venueType as string) || null;
      const resolvedVenueType = newVenueType || lastVenueTypeRef.current || 'venue';
      if (resolvedVenueType !== lastVenueTypeRef.current) {
        lastVenueTypeRef.current = resolvedVenueType;
        setVenueType(resolvedVenueType);
        AsyncStorage.setItem('lastKnownVenueType', resolvedVenueType).catch(() => {});
      }
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
      // Read subscriptionOverride — shape: { plan: 'core'|'core_plus'; modules: string[] } | null.
      // null means no override; normal Stripe-driven entitlement applies.
      // Validated defensively: wrong shape or missing fields → treated as null.
      const rawOverride = data?.subscriptionOverride ?? null;
      const resolvedOverride: SubscriptionOverride | null = (
        rawOverride !== null &&
        typeof rawOverride === 'object' &&
        (rawOverride.plan === 'core' || rawOverride.plan === 'core_plus') &&
        Array.isArray(rawOverride.modules)
      ) ? {
        plan: rawOverride.plan as 'core' | 'core_plus',
        modules: (rawOverride.modules as any[]).filter((m: any) => typeof m === 'string'),
      } : null;
      setSubscriptionOverride(resolvedOverride);
      // legacyFreeAccess — boolean flag set via Firebase Console only (never client-writable;
      // protected by omission from the venue update hasOnlyFields allowlist in firestore.rules).
      // Grants permanent full access regardless of Stripe state — for grandfathered pilot venues.
      setLegacyFreeAccess(data?.legacyFreeAccess === true);
      setOwnerUid((data?.ownerUid as string) || null);
      const rawCreatedAt = data?.createdAt;
      setVenueCreatedAt(rawCreatedAt?.toDate ? rawCreatedAt.toDate() : null);
    }, (err) => {
      if (__DEV__) console.log('[TallyUp VenueProvider] venue snapshot error', JSON.stringify({ code: err?.code, message: err?.message }));
      // Only clear state on permanent errors — not transient network issues
      if (err?.code === 'permission-denied') {
        // User has been removed from this venue — clear context so HomeRouter can redirect
        setVenueId(null);
        setSubscription(null);
        setSubscriptionOverride(null);
        setLegacyFreeAccess(false);
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

  // Read pilotTriggerDate from config/billing — reactive, no rebuild needed when date changes.
  // This is a global config doc, not per-venue, so it mounts once with no dependency.
  useEffect(() => {
    const unsubConfig = onSnapshot(
      doc(db, 'config', 'billing'),
      (snap) => {
        if (snap.exists()) {
          const d = snap.data();
          const ts = d?.pilotTriggerDate;
          setPilotTriggerDate(ts?.toDate ? ts.toDate() : null);
          setEnforceReadOnly(d?.enforceReadOnly === true);
        } else {
          setPilotTriggerDate(null);
          setEnforceReadOnly(false);
        }
      },
      () => { setPilotTriggerDate(null); setEnforceReadOnly(false); },
    );
    return unsubConfig;
  }, []);

  // Pre-cache global_products for venue's known barcodes
  // This warms Firestore's offline cache so barcodes resolve without network
  // Runs once per venue load when online — silent, non-blocking
  useEffect(() => {
    if (!venueId) return;

    let cancelled = false;
    (async () => {
      try {
        // Check connectivity — only pre-cache when online
        const NetInfo = require('@react-native-community/netinfo').default;
        const netState = await NetInfo.fetch();
        const isOnline = netState.isConnected === true && netState.isInternetReachable !== false;
        if (!isOnline) return;

        // Load venue products that have barcodes
        const productsSnap = await getDocs(
          collection(db, 'venues', venueId, 'products')
        );
        if (cancelled) return;

        const barcodes: string[] = [];
        productsSnap.forEach(d => {
          const p = d.data() as any;
          const bc = (p.barcode || p.barcodeNumber || p.barCode || '').toString().trim();
          if (bc && bc.length > 4) barcodes.push(bc);
        });

        if (barcodes.length === 0) return;

        // Deduplicate and cap at 100 barcodes to avoid excessive reads
        const unique = [...new Set(barcodes)].slice(0, 100);

        // Pre-fetch from global_products in small parallel batches
        // Firestore caches these reads — they'll serve offline next time
        const BATCH = 10;
        for (let i = 0; i < unique.length; i += BATCH) {
          if (cancelled) return;
          const chunk = unique.slice(i, i + BATCH);
          await Promise.all(
            chunk.map(bc => Promise.all([
              getDocs(query(
                collection(db, 'global_products'),
                where('barcode', '==', bc)
              )),
              getDocs(query(
                collection(db, 'global_products'),
                where('barcodeNumber', '==', bc)
              )),
            ]))
          );
          // Small delay between batches to avoid hammering Firestore
          if (i + BATCH < unique.length) await new Promise(r => setTimeout(r, 200));
        }

        if (__DEV__) console.log(`[VenueProvider] pre-cached ${unique.length} barcodes for offline use`);
      } catch {
        // Non-fatal — silent fail
      }
    })();

    return () => { cancelled = true; };
  }, [venueId]);

  // ── D-039 trial state snapshot ───────────────────────────────────────────
  // Loads trialState (and moduleTrialState) for the active venue.
  // Resets to undefined (loading) on venue change so the entitlement branch
  // stays generous until the snapshot fires.
  useEffect(() => {
    if (!venueId) {
      setTrialState(undefined);
      setModuleTrialState(null);
      return;
    }
    setTrialState(undefined);
    const unsub1 = onSnapshot(
      doc(db, 'venues', venueId, 'billing', 'trialState'),
      (snap) => setTrialState(snap.exists() ? (snap.data() as TrialStateDoc) : null),
      () => setTrialState(null),
    );
    const unsub2 = onSnapshot(
      doc(db, 'venues', venueId, 'billing', 'moduleTrialState'),
      (snap) => setModuleTrialState(snap.exists() ? (snap.data() as Record<string, ModuleTrialEntry>) : null),
      () => setModuleTrialState(null),
    );
    return () => { unsub1(); unsub2(); };
  }, [venueId]);


  // ── D-039 new-module trial creation ─────────────────────────────────────
  // For each module whose catalog-introduction date is AFTER this venue's
  // trial startedAt, write a 14-day moduleTrialState entry on first encounter.
  // setDoc with merge:true ensures we never overwrite an existing entry.
  useEffect(() => {
    if (!venueId || !trialState || !trialState.startedAt) return;
    const trialStartMs = trialState.startedAt.toMillis?.() ?? 0;
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
    const trialActive = trialState.stocktakesUsed < 3 && Date.now() < trialStartMs + THIRTY_DAYS_MS;
    if (!trialActive) return;

    const newEntries: Record<string, any> = {};
    for (const [moduleId, introducedAt] of Object.entries(MODULE_INTRODUCED_AT)) {
      if (introducedAt.getTime() > trialStartMs && !(moduleTrialState?.[moduleId])) {
        const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
        newEntries[moduleId] = { startedAt: serverTimestamp(), expiresAt, status: 'active' };
      }
    }
    if (Object.keys(newEntries).length === 0) return;

    setDoc(doc(db, 'venues', venueId, 'billing', 'moduleTrialState'), newEntries, { merge: true })
      .catch(e => console.warn('[VenueProvider] module trial init failed:', e));
  }, [venueId, trialState, moduleTrialState]);

  // ── Entitlement computation ──────────────────────────────────────────────
  // Delegated to resolveEntitlements() — pure function with identical logic.
  // subscription is passed as undefined until the first venue snapshot arrives
  // so ready is false during the initial load (null is ambiguous: loaded+absent).
  const {
    isPilot, isActive, plan, hasModule, billingState, discountPercent, ready,
  } = resolveEntitlements({
    venueId,
    ownerUid,
    venueCreatedAt,
    pilotTriggerDate,
    legacyFreeAccess,
    subscriptionOverride,
    // Pass undefined (not-yet-loaded) unless the snapshot belongs to the current venue.
    // This prevents stale subscription data from a previously-active venue being used.
    subscription: venueDocVenueId === venueId ? subscription : undefined,
    trialState,
    moduleTrialState,
    // Pass null (loading) unless the snapshot belongs to the current venue.
    // Prevents stale venueType (e.g. 'festival') from a previous venue leaking in.
    venueType: venueDocVenueId === venueId ? venueType : null,
  });

  const value = useMemo(() => ({
    loading,
    user,
    venueId,
    activeVenueId: venueId,
    venueIds,
    venueType,
    venueCountry,
    // Optimistic update for initial venue creation: called by CreateVenueScreen after all
    // Firestore writes succeed but before navigation.reset, so HomeRouter never sees a
    // stale null venueId and bounces the user back to a blank CreateVenueScreen.
    // Mirrors the same pattern used internally by switchVenue().
    initVenue: (newVenueId: string, newVenueType: string, newVenueCountry: string) => {
      setVenueId(newVenueId);
      setVenueIds(ids => ids.includes(newVenueId) ? ids : [...ids, newVenueId]);
      setVenueType(newVenueType);
      setVenueCountry(newVenueCountry);
      AsyncStorage.setItem('lastKnownVenueType', newVenueType).catch(() => {});
    },
    switchVenue: async (newVenueId: string) => {
      if (!user) throw new Error('Not signed in');
      const memberSnap = await getDoc(doc(db, 'venues', newVenueId, 'members', user.uid));
      if (!memberSnap.exists()) throw new Error('Not a member of this venue');
      // Fetch new venue's type immediately so UI updates before onSnapshot fires
      const venueSnap = await getDoc(doc(db, 'venues', newVenueId));
      const newType = (venueSnap.data()?.venueType as string) || 'venue';
      const newCountry = (venueSnap.data()?.country as string) || 'NZ';
      // Snapshot all previous values so we can roll back if the Firestore write fails
      const prevVenueId = venueId;
      const prevVenueType = venueType;
      const prevVenueCountry = venueCountry;
      // Optimistic update — all three now consistent before the write lands
      setVenueId(newVenueId);
      setVenueType(newType);
      AsyncStorage.setItem('lastKnownVenueType', newType).catch(() => {});
      setVenueCountry(newCountry);
      // Write to Firestore — onSnapshot will confirm/reconcile shortly after.
      // On failure, roll back all three optimistic values and rethrow.
      try {
        await updateDoc(doc(db, 'users', user.uid), {
          activeVenueId: newVenueId,
          touchedAt: serverTimestamp(),
        });
      } catch (e) {
        setVenueId(prevVenueId);
        setVenueType(prevVenueType);
        setVenueCountry(prevVenueCountry);
        throw e;
      }
    },
    refresh: () => setNonce(n => n + 1),
    attachVenueIfMissing: async () => { if (user) await attemptAutoAttach(user); },
    subscription,
    subscriptionOverride,
    isPilot,
    isActive,
    plan,
    hasModule,
    billingState,
    discountPercent,
    ready,
    enforceReadOnly,
    stocktakeActive,
    trialState,
  }), [loading, user, venueId, venueIds, venueType, venueCountry, subscription, subscriptionOverride, isPilot, isActive, plan, ownerUid, venueCreatedAt, pilotTriggerDate, discountPercent, trialState, moduleTrialState, venueDocVenueId, ready, enforceReadOnly, stocktakeActive]);

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
  const { subscription, subscriptionOverride, isPilot, isActive, plan, hasModule, billingState, discountPercent } = useContext(Ctx);
  return { subscription, subscriptionOverride, isPilot, isActive, plan, hasModule, billingState, discountPercent };
}
