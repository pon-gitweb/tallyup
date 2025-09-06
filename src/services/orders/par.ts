import { getApp } from 'firebase/app';
import { getFirestore, doc, setDoc } from 'firebase/firestore';

export async function setParSmart(venueId: string, productId: string, par: number): Promise<void> {
  const db = getFirestore(getApp());
  await setDoc(
    doc(db, 'venues', venueId, 'products', productId),
    { par, parLevel: par, updatedAt: new Date() },
    { merge: true }
  );
}
