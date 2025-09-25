import { getApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  getDocs,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';

/** Ensure a product exists and optionally seed a name */
export async function ensureProduct(venueId: string, productId: string, name?: string | null) {
  const db = getFirestore(getApp());
  const ref = doc(db, 'venues', venueId, 'products', productId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, { name: name ?? productId, createdAt: serverTimestamp() }, { merge: true });
  } else if (name && !snap.data()?.name) {
    await updateDoc(ref, { name, updatedAt: serverTimestamp() });
  }
  if (__DEV__) console.log('[linking/ensureProduct] ok', { venueId, productId, name });
}

/**
 * Link orphan area items (no productId/productRef) to the given product.
 * We match by:
 *   • area item doc id === targetId
 *   • OR area item name === targetId
 *   • OR area item name === productName (if provided)
 * Optionally backfill supplierId onto the area item for UI niceness.
 */
export async function linkOrphanAreaItemsToProduct(
  venueId: string,
  targetId: string,
  productId: string,
  opts: { supplierId?: string | null; productName?: string | null } = {}
) {
  const db = getFirestore(getApp());
  const deps = await getDocs(collection(db, 'venues', venueId, 'departments'));
  let linked = 0;

  for (const dep of deps.docs) {
    const areas = await getDocs(collection(db, 'venues', venueId, 'departments', dep.id, 'areas'));
    for (const area of areas.docs) {
      const items = await getDocs(collection(db, 'venues', venueId, 'departments', dep.id, 'areas', area.id, 'items'));
      for (const it of items.docs) {
        const d = it.data() as any;
        const alreadyLinked = !!(d?.productId || d?.productRef?.id || d?.product?.id);
        if (alreadyLinked) continue;

        const name: string | null = d?.name ?? d?.productName ?? null;
        const match =
          it.id === targetId ||
          (name != null && (name === targetId || (opts.productName != null && name === opts.productName)));

        if (!match) continue;

        const ref = doc(db, 'venues', venueId, 'departments', dep.id, 'areas', area.id, 'items', it.id);
        const update: any = { productId, updatedAt: serverTimestamp() };
        if (opts.supplierId) update.supplierId = opts.supplierId;

        await updateDoc(ref, update);
        linked++;
      }
    }
  }
  if (__DEV__) {
    console.log('[linking/linkOrphanAreaItemsToProduct] linked', {
      venueId, target: targetId, productId, linked, supplierId: opts.supplierId ?? null, productName: opts.productName ?? null
    });
  }
  return linked;
}
