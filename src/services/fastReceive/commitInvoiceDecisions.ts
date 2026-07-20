import { getAuth } from 'firebase/auth';

type CommitDecisionsArgs = {
  venueId: string;
  snapshotId: string;
  acceptedProposalIds: string[];
  acceptSupplierCandidate: boolean;
};

type CommitDecisionsResult = {
  ok: boolean;
  supplierId: string | null;
  supplierName: string | null;
  changed: number;
  created: number;
  skipped: number;
};

const _FALLBACK = 'https://us-central1-tallyup-f1463.cloudfunctions.net/api';
const BASE = ((typeof process !== 'undefined' && (process as any).env?.EXPO_PUBLIC_AI_URL)
  ? String((process as any).env.EXPO_PUBLIC_AI_URL)
  : _FALLBACK).replace(/\/+$/, '');

async function postJson(url: string, body: any) {
  const idToken = await getAuth().currentUser?.getIdToken().catch(() => null);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (idToken) headers['authorization'] = `Bearer ${idToken}`;
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return res;
}

export async function commitInvoiceDecisions(
  args: CommitDecisionsArgs,
): Promise<CommitDecisionsResult> {
  if (!BASE) throw new Error('Missing EXPO_PUBLIC_AI_URL');

  const primary = `${BASE}/commit-invoice-decisions`;
  const fallback = `${BASE}/api/commit-invoice-decisions`;

  let res = await postJson(primary, args);
  if (res.status === 404) {
    if (__DEV__) console.log('[commitInvoiceDecisions] primary 404, trying fallback', fallback);
    res = await postJson(fallback, args);
  }

  const json = await res.json().catch(() => null);
  if (!res.ok || !json || json.ok === false) {
    const msg = (json && (json.error || json.message)) || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json as CommitDecisionsResult;
}
