import { useEffect, useState } from 'react';
import { getApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  onSnapshot,
  QuerySnapshot,
  DocumentData,
} from 'firebase/firestore';

type DeptStatus = 'idle' | 'active' | 'completed' | null;

/**
 * Live status of a department by watching its areas:
 * - idle: no area started
 * - active: some started but not all completed
 * - completed: all areas completed (and at least 1 area exists)
 */
export default function useDepartmentActive(venueId?: string, departmentId?: string): DeptStatus {
  const [status, setStatus] = useState<DeptStatus>(null);

  useEffect(() => {
    if (!venueId || !departmentId) { setStatus(null); return; }

    const db = getFirestore(getApp());
    const areasCol = collection(db, 'venues', venueId, 'departments', departmentId, 'areas');

    const unsub = onSnapshot(
      areasCol,
      (snap: QuerySnapshot<DocumentData>) => {
        if (snap.empty) { setStatus('idle'); return; }
        let anyStarted = false;
        let allCompleted = true;

        snap.forEach(doc => {
          const d = doc.data() as any;
          const started = !!d?.startedAt;
          const completed = !!d?.completedAt;
          if (started) anyStarted = true;
          if (!completed) allCompleted = false;
        });

        setStatus(allCompleted ? 'completed' : anyStarted ? 'active' : 'idle');
      },
      (err) => {
        console.warn('[useDepartmentActive] snapshot error', err?.message || err);
        setStatus(null);
      }
    );

    return () => unsub();
  }, [venueId, departmentId]);

  return status;
}
