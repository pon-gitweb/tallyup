// @ts-nocheck
import { getAuth } from 'firebase/auth';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { db, storage } from '../firebase';
import { doc, setDoc, updateDoc, getDoc, serverTimestamp } from 'firebase/firestore';

type RunArgs = { venueId: string; localUri: string };

export async function runPhotoOcrJob({ venueId, localUri }: RunArgs) {
  const auth = getAuth();
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Not signed in');

  // 1) Upload image to storage
  const jobId = `${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
  const path = `venues/${venueId}/ocr/${uid}/${jobId}.jpg`;

  const resp = await fetch(localUri);
  const blob = await resp.blob();
  const sref = ref(storage, path);
  await uploadBytes(sref, blob);
  const gsUrl = `gs://${sref.bucket}/${sref.fullPath}`;
  const httpsUrl = await getDownloadURL(sref);

  // 2) Create job doc
  const jref = doc(db, 'venues', venueId, 'ocrJobs', jobId);
  await setDoc(jref, {
    status: 'uploaded',           // Cloud Function listens for this
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    uploadedBy: uid,
    file: { path, gsUrl, httpsUrl }
  });

  // 3) Flip to 'queued' to explicitly signal process
  await updateDoc(jref, { status: 'queued', updatedAt: serverTimestamp() });

  // 4) Poll job until done / failed
  const started = Date.now();
  while (Date.now() - started < 60_000) {
    await new Promise(r => setTimeout(r, 1200));
    const snap = await getDoc(jref);
    const data:any = snap.data();
    if (!data) continue;
    if (data.status === 'done') {
      // Normalized shape for your mapper
      return {
        supplierName: data?.result?.supplierName || undefined,
        invoiceNumber: data?.result?.invoiceNumber || undefined,
        deliveryDate: data?.result?.deliveryDate || undefined,
        lines: (data?.result?.lines || []).map((l:any) => ({
          name: l.name || '',
          qty: Number(l.qty ?? 0),
          unit: l.unit || undefined,
          unitPrice: l.unitPrice != null ? Number(l.unitPrice) : undefined
        })),
        raw: data?.raw || data?.result || data
      };
    }
    if (data.status === 'error') {
      throw new Error(data.errorMessage || 'OCR job failed');
    }
  }
  throw new Error('OCR timed out; please try again');
}
