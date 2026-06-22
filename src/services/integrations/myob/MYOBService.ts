/**
 * MYOBService — Hosti × MYOB Business Integration
 *
 * Architecture (mirrors XeroService.ts):
 * - OAuth2 connection stored per venue in Firestore
 * - Firebase Function handles token exchange/refresh and all real API calls
 * - Client only triggers actions and reads status
 *
 * Current state: Structure ready, activation pending MYOB developer account
 * registration and sandbox testing. Register at: developer.myob.com
 *
 * MYOB OAuth2 differs from Xero's in a few ways (confirmed against MYOB's
 * own docs, not guessed):
 * - Authorize host is secure.myob.com (not login.myob.com), path
 *   /oauth2/account/authorize, and MYOB requires `prompt=consent` in the
 *   query string or the businessId (company file identifier) is not
 *   returned on the callback redirect.
 * - The same "API Key" issued by MYOB plays two roles: it's the OAuth
 *   `client_id`, and the exact same value is also sent as the
 *   `x-myobapi-key` header on every authenticated API call (done
 *   server-side — see functions/src/api.ts). CLIENT_ID and API_KEY below
 *   are kept as two separate constants so each call site stays
 *   self-documenting about which role it's playing, even though they'll
 *   hold the same real value once registered.
 * - Access tokens expire in 20 minutes (1200s, confirmed against MYOB's
 *   OAuth2.0 guide); refresh tokens last 1 week. Both are stored
 *   server-side only — never in this client-visible connection doc.
 */

import { Linking } from 'react-native';
import { getFirestore, doc, getDoc, deleteDoc } from 'firebase/firestore';
import { AI_BASE_URL } from '../../../config/ai';

export type MYOBConnectionStatus =
  | 'not_connected'
  | 'connecting'
  | 'connected'
  | 'expired'
  | 'error';

export type MYOBConnection = {
  status: MYOBConnectionStatus;
  /** GUID identifying the connected MYOB company file — MYOB's equivalent of Xero's tenantId. */
  companyFileId?: string;
  companyFileName?: string;
  connectedAt?: string;
  expiresAt?: string;
};

export type MYOBSyncResult = {
  ok: boolean;
  billId?: string;
  error?: string;
};

class MYOBServiceClass {
  private db = getFirestore();

  async getConnection(venueId: string): Promise<MYOBConnection> {
    try {
      const snap = await getDoc(doc(this.db, 'venues', venueId, 'integrations', 'myob'));
      if (!snap.exists()) return { status: 'not_connected' };
      return snap.data() as MYOBConnection;
    } catch {
      return { status: 'error' };
    }
  }

  async startOAuthFlow(venueId: string): Promise<void> {
    // In production: call Firebase Function to get the OAuth URL
    // For now: direct to MYOB OAuth with your app credentials
    // TODO: Replace with real MYOB app credentials from developer.myob.com
    const CLIENT_ID = 'YOUR_MYOB_CLIENT_ID';
    // Same underlying credential as CLIENT_ID (MYOB calls it the "API Key") —
    // also sent as the x-myobapi-key header on every API call, server-side.
    const API_KEY = 'YOUR_MYOB_API_KEY';
    const REDIRECT_URI = encodeURIComponent(`${AI_BASE_URL}/api/myob/callback`);
    // TODO: confirm exact scope names for keys created after the March 2025
    // MYOB OAuth2.0 scope changes (the old "CompanyFile" scope no longer
    // works for new keys) — see apisupport.myob.com "MYOB OAuth2.0 Scope
    // Changes" article before activation.
    const SCOPES = encodeURIComponent('CompanyFile');
    const STATE = encodeURIComponent(JSON.stringify({ venueId }));

    const url = `https://secure.myob.com/oauth2/account/authorize?client_id=${CLIENT_ID}&redirect_uri=${REDIRECT_URI}&response_type=code&scope=${SCOPES}&state=${STATE}&prompt=consent`;

    void API_KEY; // documented above for the server-side header; not needed to build this URL
    await Linking.openURL(url);
  }

  async disconnect(venueId: string): Promise<void> {
    try {
      await deleteDoc(doc(this.db, 'venues', venueId, 'integrations', 'myob'));
    } catch {}
  }

  /**
   * Push a placed order to MYOB as a Bill
   * Called after order is marked as placed in OrderDispatchModal
   */
  async pushOrderAsBill(venueId: string, orderId: string): Promise<MYOBSyncResult> {
    try {
      const connection = await this.getConnection(venueId);
      if (connection.status !== 'connected') {
        return { ok: false, error: 'MYOB not connected' };
      }
      const resp = await fetch(`${AI_BASE_URL}/api/myob/push-bill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ venueId, orderId, companyFileId: connection.companyFileId }),
      });
      const data = await resp.json();
      if (!resp.ok) return { ok: false, error: data?.error || 'Push failed' };
      return { ok: true, billId: data.billId };
    } catch (e: any) {
      return { ok: false, error: e?.message || 'Unknown error' };
    }
  }

  /**
   * Push a received invoice to MYOB as a Bill
   * Called after invoice is matched and approved
   */
  async pushInvoiceAsBill(venueId: string, invoiceId: string): Promise<MYOBSyncResult> {
    try {
      const connection = await this.getConnection(venueId);
      if (connection.status !== 'connected') {
        return { ok: false, error: 'MYOB not connected' };
      }
      const resp = await fetch(`${AI_BASE_URL}/api/myob/push-invoice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ venueId, invoiceId, companyFileId: connection.companyFileId }),
      });
      const data = await resp.json();
      if (!resp.ok) return { ok: false, error: data?.error || 'Push failed' };
      return { ok: true, billId: data.billId };
    } catch (e: any) {
      return { ok: false, error: e?.message || 'Unknown error' };
    }
  }
}

export const MYOBService = new MYOBServiceClass();
