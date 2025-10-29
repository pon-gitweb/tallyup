// @ts-nocheck
import { getApp } from 'firebase/app';
import { getStorage, ref, uploadString } from 'firebase/storage';

/**
 * Build a dated upload path under /uploads/{venueId}/YYYY-MM-DD/{filename}
 */
export function buildDatedUploadPath(venueId:string, filename:string): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  const safe = String(filename||'file.txt').replace(/[^\w.\-]/g,'_');
  return `uploads/${venueId}/${yyyy}-${mm}-${dd}/${safe}`;
}

/**
 * Upload text content (e.g., CSV) to Firebase Storage.
 * Uses uploadString(..., 'raw') to avoid Blob dependencies.
 */
export async function uploadText(
  venueId:string,
  filename:string,
  content:string,
  contentType:string='text/plain'
): Promise<{ fullPath:string; downloadURL?:string }> {
  if (!venueId) throw new Error('venueId required');
  const storage = getStorage(getApp());
  const path = buildDatedUploadPath(venueId, filename);
  const r = ref(storage, path);
  await uploadString(r, String(content||''), 'raw', { contentType });
  // Optional: obtaining downloadURL needs getDownloadURL; we don’t require it here.
  return { fullPath: path };
}
