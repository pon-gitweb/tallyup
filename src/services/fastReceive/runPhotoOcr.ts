// src/services/fastReceive/runPhotoOcr.ts
// @ts-nocheck
import { getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

function getProjectId(): string {
  try {
    const app = getApp();
    // RN Firebase v10+ keeps projectId on options
    const id =
      (app as any)?.options?.projectId ||
      (app as any)?._options?.projectId ||
      (app as any)?.options?.projectId;
    if (!id) throw new Error('projectId not found on Firebase app options');
    return String(id);
  } catch {
    // last-resort: use what your logs show if needed
    return 'tallyup-f1463';
  }
}

export async function runPhotoOcr(venueId: string, fastId: string) {
  if (!venueId) throw new Error('runPhotoOcr: venueId required');
  if (!fastId) throw new Error('runPhotoOcr: fastId required');

  const auth = getAuth();
  const idToken = await auth.currentUser?.getIdToken().catch(() => null);
  if (!idToken) throw new Error('Missing auth token');

  const region =
    (typeof process !== 'undefined' && (process as any).env?.EXPO_PUBLIC_FUNCTIONS_REGION) ||
    'us-central1';
  const project = getProjectId();

  // HTTPS endpoint for an onCall function: POST { data: {...} } with Bearer token
  const url = `https://${region}-${project}.cloudfunctions.net/ocrFastReceivePhoto`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ data: { venueId, fastId } }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    // onCall errors usually look like { error: { status, message } }
    const errMsg =
      json?.error?.message ||
      json?.message ||
      `HTTP ${res.status}`;
    throw new Error(`OCR call failed: ${errMsg}`);
  }

  // onCall over HTTPS returns { result: <your data> }
  const out = json?.result ?? json ?? { ok: false };
  return out;
}

export default runPhotoOcr;