// @ts-nocheck
import { getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

const AI_BASE_URL = process.env.EXPO_PUBLIC_AI_URL || 'https://us-central1-tallyup-f1463.cloudfunctions.net';

export async function processInvoicePhoto(args: { venueId: string; storagePath: string }) {
  const { venueId, storagePath } = args;
  const auth = getAuth(getApp());
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Not authenticated');

  const resp = await fetch(`${AI_BASE_URL}/api/process-invoice-photo`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ venueId, storagePath }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error || `Photo OCR failed (${resp.status})`);
  }

  return resp.json();
}
