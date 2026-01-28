// @ts-nocheck
import { db } from '../firebase';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';

/**
 * Evidence record for product-specific photo count.
 * We store snapshots (names) so the UI never needs to show IDs.
 */
export async function createStockTakePhotoDoc(params: {
  venueId: string;
  departmentId: string | null;
  areaId: string;
  areaNameSnapshot: string | null;
  areaStartedAtMs: number | null;

  itemId: string;
  itemNameSnapshot: string | null;
  unitSnapshot: string | null;

  count: number;
  note?: string | null;

  storagePath: string;
  createdBy: string | null;
}) {
  const {
    venueId, departmentId, areaId, areaNameSnapshot, areaStartedAtMs,
    itemId, itemNameSnapshot, unitSnapshot,
    count, note, storagePath, createdBy
  } = params;

  if (!venueId) throw new Error('createStockTakePhotoDoc: missing venueId');
  if (!areaId) throw new Error('createStockTakePhotoDoc: missing areaId');
  if (!itemId) throw new Error('createStockTakePhotoDoc: missing itemId');
  if (!storagePath) throw new Error('createStockTakePhotoDoc: missing storagePath');

  const colRef = collection(db, 'venues', venueId, 'stockTakePhotos');

  const payload = {
    mode: 'product', // future: 'container'
    departmentId: departmentId || null,

    areaId,
    areaNameSnapshot: areaNameSnapshot || null,
    areaStartedAtMs: typeof areaStartedAtMs === 'number' ? areaStartedAtMs : null,

    itemId,
    itemNameSnapshot: itemNameSnapshot || null,
    unitSnapshot: unitSnapshot || null,

    count: Number.isFinite(Number(count)) ? Number(count) : null,
    note: (note || '').trim() ? (note || '').trim() : null,

    storagePath,
    createdBy: createdBy || null,

    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const res = await addDoc(colRef, payload);
  return { id: res.id, ...payload };
}
