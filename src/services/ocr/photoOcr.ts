// @ts-nocheck
// Cloud Function–based Photo OCR for invoices.
// Client no longer writes directly to Storage; instead we:
//  1) Read the image file as base64
//  2) POST to a callable Cloud Function with ID token
//  3) Receive normalized invoice lines back

import { getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import * as FileSystem from 'expo-file-system';

type RunArgs = { venueId: string; localUri: string };

function getProjectId(): string {
  try {
    const app = getApp();
    const id =
      (app as any)?.options?.projectId ||
      (app as any)?._options?.projectId ||
      (app as any)?.options?.projectId;
    if (!id) throw new Error('projectId not found on Firebase app options');
    return String(id);
  } catch {
    // Fallback to your known projectId (seen in logs)
    return 'tallyup-f1463';
  }
}

export async function runPhotoOcrJob({ venueId, localUri }: RunArgs) {
  const auth = getAuth();
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Not signed in');
  if (!venueId) throw new Error('Missing venueId');
  if (!localUri) throw new Error('Missing localUri');

  console.log('[PhotoOCR] runPhotoOcrJob via Cloud Function: start', {
    venueId,
    uid,
    localUri,
  });

  const idToken = await auth.currentUser?.getIdToken().catch(() => null);
  if (!idToken) {
    throw new Error('Missing auth token for OCR call');
  }

  // 1) Read local file as base64
  const base64 = await FileSystem.readAsStringAsync(localUri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  console.log('[PhotoOCR] image read as base64', {
    length: base64 ? base64.length : 0,
  });

  // 2) Build callable URL (same pattern as ocrFastReceivePhoto)
  const region =
    (typeof process !== 'undefined' &&
      (process as any).env?.EXPO_PUBLIC_FUNCTIONS_REGION) ||
    'us-central1';
  const projectId = getProjectId();
  const url = `https://${region}-${projectId}.cloudfunctions.net/ocrInvoicePhoto`;

  console.log('[PhotoOCR] calling Cloud Function', { url });

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      // onCall protocol: { data: {...} }
      data: {
        venueId,
        imageBase64: base64,
      },
    }),
  });

  const json = await res.json().catch(() => ({} as any));
  console.log('[PhotoOCR] function response', {
    status: res.status,
    jsonKeys: json ? Object.keys(json) : [],
  });

  if (!res.ok) {
    const errMsg =
      json?.error?.message || json?.message || `HTTP ${res.status}`;
    throw new Error(`OCR call failed: ${errMsg}`);
  }

  // Callable returns { result: ... } or direct object; support both
  const out = json?.result ?? json ?? {};
  const linesRaw = Array.isArray(out.lines) ? out.lines : [];

  if (!linesRaw.length) {
    console.log('[PhotoOCR] no lines returned from OCR', { out });
    throw new Error('OCR did not return any line items');
  }

  const normalizedLines = linesRaw.map((l: any) => ({
    name: l?.name || '',
    qty: Number(l?.qty ?? 0),
    unit: l?.unit || undefined,
    unitPrice: l?.unitPrice != null ? Number(l?.unitPrice) : undefined,
  }));

  const payload = {
    supplierName: out?.supplierName || undefined,
    invoiceNumber: out?.invoiceNumber || undefined,
    deliveryDate: out?.deliveryDate || undefined,
    lines: normalizedLines,
    raw: out,
  };

  console.log('[PhotoOCR] normalized payload ready', {
    supplierName: payload.supplierName,
    invoiceNumber: payload.invoiceNumber,
    deliveryDate: payload.deliveryDate,
    linesCount: payload.lines.length,
  });

  return payload;
}

export default runPhotoOcrJob;
