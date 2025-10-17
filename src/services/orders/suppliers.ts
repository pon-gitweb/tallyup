import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';

async function resolveSupplierName(
  venueId: string,
  supplierId: string,
  supplierName?: string
): Promise<string | undefined> {
  if (typeof supplierName === 'string' && supplierName.trim().length > 0) return supplierName.trim();
  if (!venueId || !supplierId) return undefined;
  const ref = doc(db, 'venues', venueId, 'suppliers', supplierId);
  const snap = await getDoc(ref);
  const data = snap.exists() ? snap.data() : null;
  const name = data && (data as any).name ? String((data as any).name) : undefined;
  return name;
}

export async function setSupplierOnProduct(
  venueId: string,
  productId: string,
  supplierId: string,
  supplierName?: string
): Promise<void> {
  if (!venueId || !productId || !supplierId) throw new Error('setSupplierOnProduct: venueId, productId, supplierId required');
  const finalName = await resolveSupplierName(venueId, supplierId, supplierName);
  const ref = doc(db, 'venues', venueId, 'products', productId);
  const payload: Record<string, any> = {
    supplierId,
    supplier: { id: supplierId },
    updatedAt: serverTimestamp(),
  };
  if (finalName) {
    payload.supplierName = finalName;
    payload.supplier.name = finalName;
  }
  await updateDoc(ref, payload);
}

export async function setSupplierSmart(
  venueId: string,
  productId: string,
  supplierId: string,
  supplierName?: string
): Promise<void> {
  return setSupplierOnProduct(venueId, productId, supplierId, supplierName);
}
