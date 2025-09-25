import {
  getFirestore, collection, addDoc, serverTimestamp, getDocs, query, orderBy, limit
} from 'firebase/firestore';

export type QuickItemInput = {
  name: string;
  unit?: string | null;
  initialQty?: number | null;   // optional: prefill lastCount
};

export async function addQuickItem(
  venueId: string,
  departmentId: string,
  areaId: string,
  payload: QuickItemInput
) {
  const db = getFirestore();
  const itemsCol = collection(db, 'venues', venueId, 'departments', departmentId, 'areas', areaId, 'items');
  const now = serverTimestamp();
  const doc = {
    name: payload.name,
    unit: payload.unit ?? null,
    createdAt: now,
    updatedAt: now,
    ...(typeof payload.initialQty === 'number'
      ? { lastCount: payload.initialQty, lastCountAt: now }
      : {}),
  };
  const res = await addDoc(itemsCol, doc);
  return res.id;
}

// Small helper to list items; ordered by name for stable UI.
export async function listAreaItems(
  venueId: string,
  departmentId: string,
  areaId: string
) {
  const db = getFirestore();
  const itemsCol = collection(db, 'venues', venueId, 'departments', departmentId, 'areas', areaId, 'items');
  const snap = await getDocs(query(itemsCol, orderBy('name'), limit(500)));
  return snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
}
