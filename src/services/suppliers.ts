import { db } from './firebase';
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
} from 'firebase/firestore';

export type Supplier = {
  id?: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  orderingMethod?: 'email' | 'portal' | 'phone';
  portalUrl?: string | null;
  defaultLeadDays?: number;

  // Timing policy (optional, used by ordering UX)
  orderCutoffLocalTime?: string | null; // "HH:mm" in venue local time
  mergeWindowHours?: number | null;     // how many hours to merge orders

  updatedAt?: any;
  createdAt?: any;
};

export async function listSuppliers(venueId: string): Promise<Supplier[]> {
  const snap = await getDocs(collection(db, 'venues', venueId, 'suppliers'));
  const out: Supplier[] = [];
  snap.forEach((d) => out.push({ id: d.id, ...(d.data() as any) }));
  return out;
}

export async function createSupplier(venueId: string, data: Supplier): Promise<string> {
  const ref = await addDoc(collection(db, 'venues', venueId, 'suppliers'), {
    name: data.name,
    email: data.email ?? null,
    phone: data.phone ?? null,
    orderingMethod: data.orderingMethod ?? 'email',
    portalUrl: data.portalUrl ?? null,
    defaultLeadDays: data.defaultLeadDays ?? 2,

    // New timing policy fields (optional)
    orderCutoffLocalTime: data.orderCutoffLocalTime ?? null,
    mergeWindowHours:
      typeof data.mergeWindowHours === 'number' ? data.mergeWindowHours : null,

    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateSupplier(venueId: string, id: string, data: Partial<Supplier>) {
  const ref = doc(db, 'venues', venueId, 'suppliers', id);
  await updateDoc(ref, {
    ...data,
    updatedAt: serverTimestamp(),
  } as any);
}

export async function deleteSupplierById(venueId: string, id: string) {
  const ref = doc(db, 'venues', venueId, 'suppliers', id);
  await deleteDoc(ref);
}
