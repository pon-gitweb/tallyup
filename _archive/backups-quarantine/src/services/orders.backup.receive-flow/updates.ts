import { getApp } from 'firebase/app';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  getDocs,
  collection,
} from 'firebase/firestore';

export async function setParOnProduct(venueId: string, productId: string, par: number) {
  const db = getFirestore(getApp());
  const ref = doc(db, 'venues', venueId, 'products', productId);
  const path = `venues/${venueId}/products/${productId}`;
  try {
    // Ensure doc exists
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, { createdAt: serverTimestamp() }, { merge: true });
    }
    // Normal write: par + parLevel
    await setDoc(
      ref,
      { par: Number(par), parLevel: Number(par), updatedAt: serverTimestamp() },
      { merge: true }
    );
    if (__DEV__) console.log('[orders/setParOnProduct] updated', { venueId, productId, par, path });
  } catch (e: any) {
    console.warn('[orders/setParOnProduct] error(primary)', {
      venueId, productId, par, path, code: e?.code, message: e?.message,
    });
    // Fallback: only parLevel (some rulesets gate specific fields)
    try {
      await setDoc(
        ref,
        { parLevel: Number(par), updatedAt: serverTimestamp() },
        { merge: true }
      );
      if (__DEV__) console.log('[orders/setParOnProduct] updated(fallback:parLevel-only)', { venueId, productId, par, path });
    } catch (e2: any) {
      console.warn('[orders/setParOnProduct] error(fallback)', {
        venueId, productId, par, path, code: e2?.code, message: e2?.message,
      });
      throw e2;
    }
  }
}

export async function setSupplierOnProduct(
  venueId: string,
  productId: string,
  supplierId: string,
  supplierName?: string | null
) {
  const db = getFirestore(getApp());
  const ref = doc(db, 'venues', venueId, 'products', productId);
  const path = `venues/${venueId}/products/${productId}`;
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, { createdAt: serverTimestamp() }, { merge: true });
    }

    let name = supplierName ?? null;
    if (!name) {
      try {
        const sSnap = await getDoc(doc(db, 'venues', venueId, 'suppliers', supplierId));
        name = (sSnap.data() as any)?.name ?? null;
      } catch {}
    }

    const payload: any = { supplierId, updatedAt: serverTimestamp() };
    if (name) payload.supplierName = name;

    await setDoc(ref, payload, { merge: true });
    if (__DEV__) {
      console.log('[orders/setSupplierOnProduct] updated', { venueId, productId, supplierId, supplierName: name ?? null, path });
    }
  } catch (e: any) {
    console.warn('[orders/setSupplierOnProduct] error', {
      venueId, productId, supplierId, path, code: e?.code, message: e?.message,
    });
    throw e;
  }
}
