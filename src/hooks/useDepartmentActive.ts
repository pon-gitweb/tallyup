import * as React from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from 'src/services/firebase';
import { path } from 'src/services/firestorePaths';

export function useDepartmentActive(venueId: string, departmentId: string) {
  const [active, setActive] = React.useState<boolean>(false);

  React.useEffect(() => {
    if (!venueId || !departmentId) return;
    const q = query(
      collection(db, path.areas(venueId, departmentId)),
      where('startedAt', '!=', null)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const anyInProgress = snap.docs.some((d) => {
          const data = d.data() || {};
          return !!data.startedAt && !data.completedAt;
        });
        setActive(anyInProgress);
      },
      (err) => {
        console.warn('[useDepartmentActive] onSnapshot error', err);
        setActive(false);
      }
    );
    return () => unsub();
  }, [venueId, departmentId]);

  return active;
}
