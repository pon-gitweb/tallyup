import { addDoc, collection, serverTimestamp, Timestamp } from 'firebase/firestore';
import { db } from '../firebase';

export type StockTakePhotoMode = 'product'; // future: 'container'

export type CreateStockTakePhotoDocParams = {
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

  storagePath: string; // we store storage fullPath (preferred). Not a URL.
  createdBy: string | null;
};

export type StockTakePhotoDoc = {
  mode: StockTakePhotoMode;
  departmentId: string | null;

  areaId: string;
  areaNameSnapshot: string | null;
  areaStartedAtMs: number | null;

  itemId: string;
  itemNameSnapshot: string | null;
  unitSnapshot: string | null;

  count: number | null;
  note: string | null;

  storagePath: string;
  createdBy: string | null;

  createdAt: Timestamp;
  updatedAt: Timestamp;
};

const cleanNote = (note?: string | null) => {
  const t = (note || '').trim();
  return t ? t : null;
};

export async function createStockTakePhotoDoc(params: CreateStockTakePhotoDocParams) {
  const {
    venueId,
    departmentId,
    areaId,
    areaNameSnapshot,
    areaStartedAtMs,
    itemId,
    itemNameSnapshot,
    unitSnapshot,
    count,
    note,
    storagePath,
    createdBy,
  } = params;

  if (!venueId) throw new Error('createStockTakePhotoDoc: missing venueId');
  if (!areaId) throw new Error('createStockTakePhotoDoc: missing areaId');
  if (!itemId) throw new Error('createStockTakePhotoDoc: missing itemId');
  if (!storagePath) throw new Error('createStockTakePhotoDoc: missing storagePath');

  const n = Number(count);
  if (!Number.isFinite(n)) throw new Error('createStockTakePhotoDoc: count must be finite');
  // Optional policy: disallow negative counts (uncomment if desired)
  // if (n < 0) throw new Error('createStockTakePhotoDoc: count cannot be negative');

  const colRef = collection(db, 'venues', venueId, 'stockTakePhotos');

  const payload: Omit<StockTakePhotoDoc, 'createdAt' | 'updatedAt'> & {
    createdAt: any;
    updatedAt: any;
  } = {
    mode: 'product',
    departmentId: departmentId || null,

    areaId,
    areaNameSnapshot: areaNameSnapshot || null,
    areaStartedAtMs: typeof areaStartedAtMs === 'number' ? areaStartedAtMs : null,

    itemId,
    itemNameSnapshot: itemNameSnapshot || null,
    unitSnapshot: unitSnapshot || null,

    count: n,
    note: cleanNote(note),

    storagePath,
    createdBy: createdBy || null,

    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const res = await addDoc(colRef, payload);
  return { id: res.id, ...payload };
}
