import {
  doc,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase'; // adjust if needed

export async function setParOnProduct(
  venueId: string,
  productId: string,
  par: number
): Promise<void> {
  if (!venueId || !productId) {
    throw new Error('setParOnProduct: venueId and productId required');
  }
  const nextPar = Number.isFinite(par) ? Math.max(0, Math.round(par)) : 0;

  const productRef = doc(db, 'venues', venueId, 'products', productId);
  await updateDoc(productRef, {
    par: nextPar,          // flat
    parLevel: nextPar,     // alias used by some suggesters
    updatedAt: serverTimestamp(),
  });
}

export async function setParSmart(
  venueId: string,
  productId: string,
  par: number
): Promise<void> {
  return setParOnProduct(venueId, productId, par);
}
