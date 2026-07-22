// @ts-nocheck
// Cloud Function–based Photo OCR for invoices.
// Client no longer writes directly to Storage; instead we:
//  1) Read the image file as base64
//  2) POST to a callable Cloud Function with ID token
//  3) Receive normalized invoice lines back

import { getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import * as FileSystem from 'expo-file-system';
import { handleAiLimitError } from '../../utils/aiLimitError';

type RunArgs = {
  venueId: string;
  // localUri is required for an initial scan, but omitted when resuming
  // a previous job (lateInvoiceDecision / confirmDeliveryMatch).
  localUri?: string;
  // Optional hint telling the backend what kind of document this is,
  // bypassing automatic classification.
  docTypeHint?: string;
  // Resume path: user decided how to handle a late invoice.
  lateInvoiceDecision?: 'apply_current' | 'hold_for_review';
  cachedInvoiceData?: any;
  // Resume path: user confirmed a medium-confidence delivery match.
  confirmDeliveryMatch?: boolean;
  deliveryId?: string;
  invoiceDocId?: string;
};

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

export async function runPhotoOcrJob({
  venueId,
  localUri,
  docTypeHint,
  lateInvoiceDecision,
  cachedInvoiceData,
  confirmDeliveryMatch,
  deliveryId,
  invoiceDocId,
}: RunArgs) {
  const auth = getAuth();
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Not signed in');
  if (!venueId) throw new Error('Missing venueId');

  const isResume = !!lateInvoiceDecision || !!confirmDeliveryMatch;
  if (!localUri && !isResume) throw new Error('Missing localUri');

  console.log('[PhotoOCR] runPhotoOcrJob via Cloud Function: start', {
    venueId,
    uid,
    localUri,
    docTypeHint,
    lateInvoiceDecision,
    confirmDeliveryMatch,
  });

  const idToken = await auth.currentUser?.getIdToken().catch(() => null);
  if (!idToken) {
    throw new Error('Missing auth token for OCR call');
  }

  const data: Record<string, any> = { venueId };

  if (localUri) {
    // Read local file as base64
    const base64 = await FileSystem.readAsStringAsync(localUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    console.log('[PhotoOCR] image read as base64', {
      length: base64 ? base64.length : 0,
    });
    data.imageBase64 = base64;
  }

  if (docTypeHint) data.docTypeHint = docTypeHint;
  if (lateInvoiceDecision) {
    data.lateInvoiceDecision = lateInvoiceDecision;
    data.cachedInvoiceData = cachedInvoiceData;
  }
  if (confirmDeliveryMatch) {
    data.confirmDeliveryMatch = true;
    data.deliveryId = deliveryId;
    data.invoiceDocId = invoiceDocId;
  }

  // Build callable URL (same pattern as ocrFastReceivePhoto)
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
      data,
    }),
  });

  const json = await res.json().catch(() => ({} as any));
  console.log('[PhotoOCR] function response', {
    status: res.status,
    jsonKeys: json ? Object.keys(json) : [],
  });

  if (!res.ok) {
    if (handleAiLimitError(json?.error?.details)) return null;
    const errMsg =
      json?.error?.message || json?.message || `HTTP ${res.status}`;
    throw new Error(`OCR call failed: ${errMsg}`);
  }

  // Callable returns { result: ... } or direct object; support both
  const out = json?.result ?? json ?? {};
  const documentType = out?.documentType || 'TAX_INVOICE';

  const linesRaw = Array.isArray(out.lines) ? out.lines : [];

  // Only tax invoices (not late, not already failed) are required to
  // come back with line items — other document types may legitimately
  // have none.
  if (documentType === 'TAX_INVOICE' && !out?.isLateInvoice && out?.ok !== false && !linesRaw.length) {
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
    ok: out?.ok !== false,
    documentType,
    supplierName: out?.supplierName || undefined,
    invoiceNumber: out?.invoiceNumber || undefined,
    deliveryDate: out?.deliveryDate || undefined,
    lines: normalizedLines,
    raw: out,
    priceChanges: Array.isArray(out?.priceChanges) ? out.priceChanges : [],
    hasPriceChanges: out?.hasPriceChanges === true,
    supplierId: out?.supplierId || null,
    invoiceDocId: out?.invoiceDocId || null,
    message: out?.message || undefined,

    // Late invoice handling
    isLateInvoice: out?.isLateInvoice === true,
    cycleEndDate: out?.cycleEndDate || null,
    invoiceData: out?.invoiceData || null,
    options: out?.options || null,

    // Delivery matching
    matched: out?.matched === true,
    matchConfidence: out?.matchConfidence || null,
    deliverySummary: out?.deliverySummary || null,
    deliveryId: out?.deliveryId || null,

    // Packing slip / delivery note / credit note results
    deliveryNoteData: out?.deliveryNoteData || null,
    requiresAction: out?.requiresAction === true,
    actions: out?.actions || null,
    stockIncremented: out?.stockIncremented === true,
    linesProcessed: out?.linesProcessed ?? null,
    unmatchedLines: out?.unmatchedLines || null,
    provisionalCost: out?.provisionalCost ?? null,
    packingSlipRef: out?.packingSlipRef || null,
    invoiceRef: out?.invoiceRef || null,
    totalAmount: out?.totalAmount ?? null,

    // Manual selection fallback
    manualSelectionRequired: out?.manualSelectionRequired === true,

    // Price extraction failure tracking
    priceExtractionIssue: out?.priceExtractionIssue === true,
    requestInvoiceCopy: out?.requestInvoiceCopy === true,
    failureSupplier: out?.failureSupplier || null,
    documentStorageRef: out?.documentStorageRef || null,
  };

  console.log('[PhotoOCR] normalized payload ready', {
    documentType: payload.documentType,
    supplierName: payload.supplierName,
    invoiceNumber: payload.invoiceNumber,
    deliveryDate: payload.deliveryDate,
    linesCount: payload.lines.length,
  });

  return payload;
}

export default runPhotoOcrJob;
