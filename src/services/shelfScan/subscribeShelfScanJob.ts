// @ts-nocheck
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';

export function subscribeShelfScanJob({
  venueId,
  jobId,
  onData,
  onError,
}:{
  venueId: string;
  jobId: string;
  onData: (job:any)=>void;
  onError?: (e:any)=>void;
}) {
  const ref = doc(db, 'venues', venueId, 'shelfScanJobs', jobId);
  return onSnapshot(ref, (snap) => {
    if (!snap.exists()) return;
    onData({ id: snap.id, ...snap.data() });
  }, (e) => onError?.(e));
}
