import { setDoc, updateDoc, writeBatch, Firestore, DocumentReference } from 'firebase/firestore';

// Deeply replace undefined with null (Firestore rejects undefined)
function sanitize<T>(v: T): T {
  if (v === undefined) return null as unknown as T;
  if (v === null) return v;
  if (Array.isArray(v)) return v.map(sanitize) as unknown as T;
  if (typeof v === 'object') {
    const out: any = {};
    for (const k of Object.keys(v as any)) out[k] = sanitize((v as any)[k]);
    return out;
  }
  return v;
}

export async function setDocSafe(ref: DocumentReference, data: any, opts?: any) {
  return setDoc(ref, sanitize(data), opts);
}

export async function updateDocSafe(ref: DocumentReference, data: any) {
  return updateDoc(ref, sanitize(data) as any);
}

export function batchSetSafe(db: Firestore) {
  const b = writeBatch(db);
  return {
    set(docRef: DocumentReference, data: any) { b.set(docRef, sanitize(data)); },
    commit() { return b.commit(); }
  };
}
