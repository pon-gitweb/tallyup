import { useEffect, useMemo, useState } from 'react';
import { doc, getDoc, getFirestore } from 'firebase/firestore';

export type IdentityUser = { displayName?: string | null; email?: string | null; uid?: string | null };
export type IdentityVenue = { name?: string | null; venueId?: string | null };

/** Abbreviate user for compact badge */
export function abbrevUser(user?: IdentityUser): string {
  const dn = user?.displayName?.trim();
  if (dn) {
    const parts = dn.split(/\s+/).filter(Boolean);
    const first = parts[0]?.[0]?.toUpperCase() ?? '';
    const last = parts[1]?.[0]?.toUpperCase() ?? '';
    return (first + (last || '')).slice(0, 2) || 'U?';
  }
  const em = user?.email?.trim();
  if (em) return em.split('@')[0].slice(0, 2).toUpperCase() || 'U?';
  if (user?.uid) return user.uid.slice(0, 2).toUpperCase();
  return 'U?';
}

/** Abbreviate venue for compact badge */
export function abbrevVenue(venue?: IdentityVenue): string {
  const vn = venue?.name?.trim();
  if (vn) {
    const clean = vn.replace(/[^A-Za-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    if (clean.length <= 6) return clean.toUpperCase();
    const words = clean.split(' ');
    if (words.length > 1) {
      return words.map(w => w[0]?.toUpperCase() || '').join('').slice(0, 5) || 'VEN?';
    }
    return clean.slice(0, 5).toUpperCase();
  }
  const id = venue?.venueId;
  if (id) return (id.replace(/^v[_-]?/i, '').slice(0, 5) || 'VEN?').toUpperCase();
  return 'VEN?';
}

/** Friendly (longer) form for titles/greetings */
export function friendlyIdentity(user?: IdentityUser, venue?: IdentityVenue): string {
  const firstName = user?.displayName?.split(' ')?.[0];
  const venueNick = venue?.name?.split(' ')?.[0];
  if (firstName && venueNick) return `${firstName} @ ${venueNick}`;
  if (firstName) return `${firstName} @ Your Venue`;
  if (venueNick) return `You @ ${venueNick}`;
  return 'You @ Your Venue';
}

/** Make badge label like "PS@HOSTI" */
export function makeBadgeLabel(user?: IdentityUser, venue?: IdentityVenue): string {
  return `${abbrevUser(user)}@${abbrevVenue(venue)}`;
}

/** Optional convenience: load venue name by id (one-time) */
export function useVenueInfo(venueId?: string | null) {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    let cancel = false;
    if (!venueId) { setName(null); return; }
    const db = getFirestore();
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'venues', venueId));
        if (!cancel) setName((snap.data() as any)?.name ?? null);
      } catch {
        if (!cancel) setName(null);
      }
    })();
    return () => { cancel = true; };
  }, [venueId]);
  return { name };
}

/** Top-level labels from primitives (no Firebase types required) */
export function useIdentityLabels(user?: IdentityUser, venue?: IdentityVenue) {
  const badge = useMemo(() => makeBadgeLabel(user, venue), [user, venue]);
  const friendly = useMemo(() => friendlyIdentity(user, venue), [user, venue]);
  return { badge, friendly };
}
