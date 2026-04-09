// @ts-nocheck
/**
 * XeroService — Hosti-Stock × Xero Integration
 *
 * Architecture:
 * - OAuth2 connection stored per venue in Firestore
 * - Firebase Function handles token exchange and API calls
 * - Client only triggers actions and reads status
 *
 * Current state: Structure ready, activation pending Xero app registration
 * Register at: developer.xero.com → New App → Web App
 * Scopes needed: accounting.transactions, accounting.contacts, offline_access
 */

import { Linking } from 'react-native';
import { getFirestore, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { AI_BASE_URL } from '../../../config/ai';

export type XeroConnectionStatus =
  | 'not_connected'
  | 'connecting'
  | 'connected'
  | 'expired'
  | 'error';

export type XeroConnection = {
  status: XeroConnectionStatus;
  tenantId?: string;
  tenantName?: string;
  connectedAt?: string;
  expiresAt?: string;
};

export type XeroSyncResult = {
  ok: boolean;
  billId?: string;
  error?: string;
};

class XeroServiceClass {
  private db = getFirestore();

  async getConnection(venueId: string): Promise<XeroConnection> {
    try {
      const snap = await getDoc(doc(this.db, 'venues', venueId, 'integrations', 'xero'));
      if (!snap.exists()) return { status: 'not_connected' };
      return snap.data() as XeroConnection;
    } catch {
      return { status: 'error' };
    }
  }

  async startOAuthFlow(venueId: string): Promise<void> {
    // In production: call Firebase Function to get the OAuth URL
    // For now: direct to Xero OAuth with your app credentials
    // TODO: Replace CLIENT_ID with real Xero app client ID from developer.xero.com
    const CLIENT_ID = 'YOUR_XERO_CLIENT_ID';
    const REDIRECT_URI = encodeURIComponent(`${AI_BASE_URL}/api/xero/callback`);
    const SCOPES = encodeURIComponent('accounting.transactions accounting.contacts offline_access openid profile email');
    const STATE = encodeURIComponent(JSON.stringify({ venueId }));

    const url = `https://login.xero.com/identity/connect/authorize?response_type=code&client_id=${CLIENT_ID}&redirect_uri=${REDIRECT_URI}&scope=${SCOPES}&state=${STATE}`;

    await Linking.openURL(url);
  }

  async disconnect(venueId: string): Promise<void> {
    try {
      await deleteDoc(doc(this.db, 'venues', venueId, 'integrations', 'xero'));
    } catch {}
  }

  /**
   * Push a placed order to Xero as a Draft Bill
   * Called after order is marked as placed in OrderDispatchModal
   */
  async pushOrderAsBill(venueId: string, orderId: string): Promise<XeroSyncResult> {
    try {
      const connection = await this.getConnection(venueId);
      if (connection.status !== 'connected') {
        return { ok: false, error: 'Xero not connected' };
      }
      // Call Firebase Function
      const resp = await fetch(`${AI_BASE_URL}/api/xero/push-bill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ venueId, orderId, tenantId: connection.tenantId }),
      });
      const data = await resp.json();
      if (!resp.ok) return { ok: false, error: data?.error || 'Push failed' };
      return { ok: true, billId: data.billId };
    } catch (e: any) {
      return { ok: false, error: e?.message || 'Unknown error' };
    }
  }

  /**
   * Push a received invoice to Xero as an Approved Bill
   * Called after invoice is matched and approved
   */
  async pushInvoiceAsBill(venueId: string, invoiceId: string): Promise<XeroSyncResult> {
    try {
      const connection = await this.getConnection(venueId);
      if (connection.status !== 'connected') {
        return { ok: false, error: 'Xero not connected' };
      }
      const resp = await fetch(`${AI_BASE_URL}/api/xero/push-invoice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ venueId, invoiceId, tenantId: connection.tenantId }),
      });
      const data = await resp.json();
      if (!resp.ok) return { ok: false, error: data?.error || 'Push failed' };
      return { ok: true, billId: data.billId };
    } catch (e: any) {
      return { ok: false, error: e?.message || 'Unknown error' };
    }
  }
}

export const XeroService = new XeroServiceClass();
