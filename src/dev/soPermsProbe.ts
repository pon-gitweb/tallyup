import { getApp } from 'firebase/app';
import { getFirestore, getDoc, doc } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

export async function probeSuggestedOrdersAccess(venueId: string) {
  const db = getFirestore(getApp());
  const uid = getAuth().currentUser?.uid;
  if (!uid) {
    console.log('[SO Probe] not signed in'); 
    return;
  }
  const uref = doc(db, 'users', uid);
  const mref = doc(db, 'venues', venueId, 'members', uid);

  try {
    const [u, m] = await Promise.all([getDoc(uref), getDoc(mref)]);
    console.log('[SO Probe] users/<uid> exists:', u.exists());
    console.log('[SO Probe] users/<uid>.venueId:', u.exists() ? (u.data() as any)?.venueId : null);
    console.log('[SO Probe] venues/<venueId>/members/<uid> exists:', m.exists());
  } catch (e: any) {
    console.log('[SO Probe] error', e?.code, e?.message);
  }
}
