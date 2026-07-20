import * as FileSystem from 'expo-file-system';
import { getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { uploadFastInvoice } from './uploadFastInvoice';

function getProjectId(): string {
  try {
    const app = getApp();
    const id =
      (app as any)?.options?.projectId ||
      (app as any)?._options?.projectId;
    if (!id) throw new Error('projectId not found on Firebase app options');
    return String(id);
  } catch {
    return 'tallyup-f1463';
  }
}

export async function scanInvoicePhoto(args: {
  venueId: string;
  photoUri: string;
  filename: string;
}): Promise<{
  invoice: { source: 'photo'; storagePath: string; poNumber: string|null; supplierName: string|null; supplierId: string|null };
  lines: any[];
  confidence: number|null;
  warnings: string[];
  supplierCandidate?: any;
  proposals: any[];
}> {
  const { venueId, photoUri, filename } = args;
  if (!venueId) throw new Error('scanInvoicePhoto: missing venueId');
  if (!photoUri) throw new Error('scanInvoicePhoto: missing photoUri');

  // Upload first — every snapshot gets a real storagePath regardless of OCR outcome
  const upload = await uploadFastInvoice(venueId, photoUri, filename, 'image/jpeg' as any);
  const storagePath: string = upload?.fullPath || '';

  // Read the same photo as base64 for the Claude payload
  const imageBase64 = await FileSystem.readAsStringAsync(photoUri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  // Call ocrInvoicePhoto (onCall function — POST { data: {...} } with Bearer token)
  const auth = getAuth();
  const idToken = await auth.currentUser?.getIdToken().catch(() => null);
  if (!idToken) throw new Error('scanInvoicePhoto: missing auth token');

  const region =
    (typeof process !== 'undefined' && (process as any).env?.EXPO_PUBLIC_FUNCTIONS_REGION) ||
    'us-central1';
  const project = getProjectId();
  const url = `https://${region}-${project}.cloudfunctions.net/ocrInvoicePhoto`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ data: { venueId, imageBase64 } }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errMsg =
      json?.error?.message ||
      json?.message ||
      `HTTP ${res.status}`;
    throw new Error(`scanInvoicePhoto: OCR call failed: ${errMsg}`);
  }

  // onCall over HTTPS returns { result: <your data> }
  const raw = json?.result ?? json ?? {};

  // Surface server-side failures (e.g. duplicate invoice detection) as thrown errors
  if (raw.ok === false) {
    throw new Error(`scanInvoicePhoto: ${raw.message || 'OCR returned ok: false'}`);
  }

  // Map flat ocrInvoicePhoto response → nested shape FastReceiveDetailModal expects.
  // Note: Photo payload uses purchaseOrderNumber (not poNumber); warnings field absent.
  const lines: any[] = Array.isArray(raw.lines) ? raw.lines : [];
  return {
    invoice: {
      source: 'photo',
      storagePath,
      poNumber: raw.purchaseOrderNumber ?? null,
      supplierName: raw.supplierName ?? null,
      supplierId: raw.supplierId ?? null,
    },
    lines,
    confidence: lines.length > 0 ? 0.8 : 0.2,
    warnings: [],
    proposals: Array.isArray(raw.proposals) ? raw.proposals : [],
    ...(raw.supplierCandidate != null ? { supplierCandidate: raw.supplierCandidate } : {}),
  };
}
