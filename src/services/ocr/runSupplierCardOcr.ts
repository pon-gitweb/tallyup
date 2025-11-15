// @ts-nocheck
import { getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import * as FileSystem from 'expo-file-system';

function getProjectId(): string {
  try {
    const app = getApp();
    const id =
      (app as any)?.options?.projectId ||
      (app as any)?._options?.projectId ||
      (app as any)?.options?.projectId;
    if (!id) throw new Error('projectId missing');
    return String(id);
  } catch {
    return 'tallyup-f1463';
  }
}

export async function runSupplierCardOcr({ venueId, localUri }) {
  if (!venueId) throw new Error('venueId required');
  if (!localUri) throw new Error('localUri required');

  const auth = getAuth();
  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) throw new Error('auth token missing');

  const imageBase64 = await FileSystem.readAsStringAsync(localUri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  const project = getProjectId();
  const region =
    (typeof process !== 'undefined' && (process as any)?.env?.EXPO_PUBLIC_FUNCTIONS_REGION) ||
    'us-central1';

  const url = `https://${region}-${project}.cloudfunctions.net/ocrSupplierCard`;

  console.log('[SupplierOCR] calling', {
    url,
    venueId,
    base64Length: imageBase64.length,
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      data: {
        venueId,
        imageBase64,
      },
    }),
  });

  const json = await res.json().catch(() => ({}));

  if (!res.ok) {
    const msg = json?.error?.message || json?.message || `HTTP ${res.status}`;
    console.log('[SupplierOCR] error', msg);
    throw new Error(msg);
  }

  console.log('[SupplierOCR] success', json);
  return json?.result ?? json;
}

export default runSupplierCardOcr;
