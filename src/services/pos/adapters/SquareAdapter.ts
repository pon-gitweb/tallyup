import { POSAdapter, POSProduct, POSSale, POSSaleItem } from '../POSService';
import { auth } from '../../firebase';
import { AI_BASE_URL } from '../../../config/ai';

// Square POS adapter — mirrors MYOBService's architecture:
// the access token lives server-side only (venues/{venueId}/integrationTokens/square,
// Admin SDK only). This adapter never sees it — every call goes through the
// /api/square/* Cloud Function proxy, authenticated with the caller's Firebase
// ID token. OAuth itself is initiated from POSConnectionScreen, not here.
async function authHeaders(): Promise<Record<string, string>> {
  const token = await auth.currentUser?.getIdToken().catch(() => null);
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export class SquareAdapter implements POSAdapter {
  readonly name = 'Square';

  // Default lets the POSRegistry's static adapter map construct one with no
  // venue context (used only for display, e.g. adapter.name) — real calls
  // always go through a venue-scoped instance, see getCurrentAdapter().
  constructor(private venueId: string = '') {}

  async isConnected(): Promise<boolean> {
    if (!this.venueId) return false;
    try {
      const headers = await authHeaders();
      const resp = await fetch(
        `${AI_BASE_URL}/api/square/status?venueId=${encodeURIComponent(this.venueId)}`,
        { method: 'GET', headers },
      );
      const data = await resp.json().catch(() => null);
      return !!(resp.ok && data?.ok && data?.connected);
    } catch {
      return false;
    }
  }

  async getProducts(): Promise<POSProduct[]> {
    return [];
  }

  async getSales(_from: Date, _to: Date): Promise<POSSale[]> {
    return [];
  }

  async getSaleItems(): Promise<POSSaleItem[]> {
    if (!this.venueId) return [];
    try {
      const headers = await authHeaders();
      const resp = await fetch(`${AI_BASE_URL}/api/square/catalog-items`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ venueId: this.venueId }),
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok || !data?.ok) return [];
      return Array.isArray(data.items) ? (data.items as POSSaleItem[]) : [];
    } catch {
      return [];
    }
  }

  // OAuth is initiated from POSConnectionScreen directly (PKCE flow opened in
  // the device browser). This just confirms a connection already exists —
  // no-op if it does, since there's nothing else for this method to do.
  async connect(_credentials: Record<string, string>): Promise<void> {
    await this.isConnected();
  }

  async disconnect(): Promise<void> {
    if (!this.venueId) return;
    try {
      const headers = await authHeaders();
      await fetch(`${AI_BASE_URL}/api/square/disconnect`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ venueId: this.venueId }),
      });
    } catch {}
  }
}
