import { useEffect, useMemo, useState } from 'react';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { db } from '../services/firebase';
import { useGuardedSnapshot } from './useGuardedSnapshot';
import { getAuth } from 'firebase/auth';

type Role = 'owner' | 'manager' | 'staff' | 'pending' | 'unknown';

export function useVenueAccess(venueId?: string | null) {
  const [role, setRole] = useState<Role>('unknown');
  const auth = getAuth();
  const uid = auth.currentUser?.uid || null;

  useEffect(() => {
    let unsub: any;
    if (!venueId || !uid) { setRole('unknown'); return; }
    (async () => {
      try {
        const v = await getDoc(doc(db, 'venues', venueId));
        const ownerUid = (v.data() as any)?.ownerUid;
        if (ownerUid && ownerUid === uid) { setRole('owner'); return; }
        unsub = onSnapshot(doc(db, 'venues', venueId, 'members', uid), (snap) => {
          const r = (snap.data() as any)?.role as Role | undefined;
          setRole((r ?? 'unknown') as Role);
        });
      } catch {
        setRole('unknown');
      }
    })();
    return () => { unsub && unsub(); };
  }, [venueId, uid]);

  const isOwner = role === 'owner';
  const isManager = role === 'manager' || role === 'owner';
  const canManage = isManager;

  return useMemo(() => ({ role, isOwner, isManager, canManage }), [role]);
}
