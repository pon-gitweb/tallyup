import { getApp } from 'firebase/app';
import {
  getFirestore, collection, getDocs, addDoc, doc, setDoc, updateDoc, deleteDoc
} from 'firebase/firestore';

export type Supplier = {
  id?: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  orderingMethod?: 'email'|'portal'|'phone';
  portalUrl?: string | null;
  defaultLeadDays?: number | null;

  // NEW (optional) merge policy & cutoff:
  // Local venue time in "HH:mm" 24h format, e.g. "16:00"
  orderCutoffLocalTime?: string | null;
  // Hours to hold for merge. If null/undefined/<=0 => no hold.
  mergeWindowHours?: number | null;
};

export async function listSuppliers(venueId: string): Promise<Supplier[]> {
  const db = getFirestore(getApp());
  const snap = await getDocs(collection(db, 'venues', venueId, 'suppliers'));
  const out: Supplier[] = [];
  snap.forEach(d => {
    const v = d.data() as any;
    out.push({
      id: d.id,
      name: v?.name ?? '(Unnamed)',
      email: v?.email ?? null,
      phone: v?.phone ?? null,
      orderingMethod: v?.orderingMethod ?? 'email',
      portalUrl: v?.portalUrl ?? null,
      defaultLeadDays: Number.isFinite(v?.defaultLeadDays) ? Number(v.defaultLeadDays) : null,
      orderCutoffLocalTime: v?.orderCutoffLocalTime ?? null,
      mergeWindowHours: Number.isFinite(v?.mergeWindowHours) ? Number(v.mergeWindowHours) : null,
    });
  });
  return out;
}

export async function createSupplier(venueId: string, data: Omit<Supplier, 'id'>) {
  const db = getFirestore(getApp());
  // Minimal required: name
  const payload: any = {
    name: (data.name || '').trim(),
  };
  if (data.email !== undefined) payload.email = data.email || null;
  if (data.phone !== undefined) payload.phone = data.phone || null;
  if (data.orderingMethod) payload.orderingMethod = data.orderingMethod;
  if (data.portalUrl !== undefined) payload.portalUrl = data.portalUrl || null;
  if (data.defaultLeadDays !== undefined) payload.defaultLeadDays = Number(data.defaultLeadDays) || null;

  // NEW optional fields:
  if (typeof data.orderCutoffLocalTime === 'string') payload.orderCutoffLocalTime = data.orderCutoffLocalTime || null;
  if (data.mergeWindowHours !== undefined) {
    const n = Number(data.mergeWindowHours);
    payload.mergeWindowHours = Number.isFinite(n) ? n : null;
  }

  await addDoc(collection(db, 'venues', venueId, 'suppliers'), payload);
}

export async function updateSupplier(venueId: string, supplierId: string, data: Partial<Supplier>) {
  const db = getFirestore(getApp());
  const ref = doc(db, 'venues', venueId, 'suppliers', supplierId);
  const patch: any = {};
  if (data.name !== undefined) patch.name = (data.name || '').trim();
  if (data.email !== undefined) patch.email = data.email || null;
  if (data.phone !== undefined) patch.phone = data.phone || null;
  if (data.orderingMethod !== undefined) patch.orderingMethod = data.orderingMethod;
  if (data.portalUrl !== undefined) patch.portalUrl = data.portalUrl || null;
  if (data.defaultLeadDays !== undefined) patch.defaultLeadDays = Number(data.defaultLeadDays) || null;

  // NEW optional fields:
  if (data.orderCutoffLocalTime !== undefined) {
    patch.orderCutoffLocalTime = data.orderCutoffLocalTime ? String(data.orderCutoffLocalTime) : null;
  }
  if (data.mergeWindowHours !== undefined) {
    const n = Number(data.mergeWindowHours);
    patch.mergeWindowHours = Number.isFinite(n) ? n : null;
  }

  await updateDoc(ref, patch);
}

export async function deleteSupplierById(venueId: string, supplierId: string) {
  const db = getFirestore(getApp());
  await deleteDoc(doc(db, 'venues', venueId, 'suppliers', supplierId));
}
