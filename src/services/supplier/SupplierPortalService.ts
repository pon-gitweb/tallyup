// @ts-nocheck
/**
 * SupplierPortalService
 * Manages supplier accounts, catalogues, orders and specials.
 *
 * Firestore structure:
 *   supplierAccounts/{supplierId}
 *     name, email, phone, logoUri, createdAt
 *     connectedVenues: string[]  — venueIds using this supplier
 *
 *   supplierAccounts/{supplierId}/catalogue/{productId}
 *     name, sku, unit, price, category, available, updatedAt
 *
 *   supplierAccounts/{supplierId}/specials/{specialId}
 *     title, description, productId, discountPct, validFrom, validTo, active
 *
 *   supplierAccounts/{supplierId}/orders/{orderId}
 *     venueId, poNumber, lines[], status, placedAt, acknowledgedAt, notes
 *
 *   supplierAccounts/{supplierId}/contracts/{contractId}
 *     venueId, fileUrl, validFrom, validTo, notes (encrypted at rest)
 */

import { getAuth } from 'firebase/auth';

export type SupplierAccount = {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  logoUri?: string | null;
  connectedVenues: string[];
  createdAt?: any;
};

export type CatalogueProduct = {
  id: string;
  name: string;
  sku?: string | null;
  unit: string;
  price: number;
  category?: string | null;
  available: boolean;
  updatedAt?: any;
};

export type SupplierSpecial = {
  id: string;
  title: string;
  description?: string | null;
  productName?: string | null;
  discountPct?: number | null;
  validFrom?: string | null;
  validTo?: string | null;
  active: boolean;
};

export type SupplierOrderStatus = 'pending' | 'acknowledged' | 'partial' | 'fulfilled' | 'cancelled';

export type SupplierOrderView = {
  id: string;
  venueId: string;
  venueName?: string;
  poNumber?: string;
  lines: { name: string; qty: number; unit?: string; unitCost?: number }[];
  status: SupplierOrderStatus;
  placedAt?: any;
  acknowledgedAt?: any;
  notes?: string | null;
};

class SupplierPortalServiceClass {
  private db = getFirestore();

  // ── Account ──────────────────────────────────────────────────────────────
  async getAccount(supplierId: string): Promise<SupplierAccount | null> {
    try {
      const snap = await getDoc(doc(this.db, 'supplierAccounts', supplierId));
      if (!snap.exists()) return null;
      return { id: snap.id, ...snap.data() } as SupplierAccount;
    } catch { return null; }
  }

  async createAccount(data: Omit<SupplierAccount, 'id' | 'connectedVenues' | 'createdAt'>): Promise<string> {
    const ref = doc(collection(this.db, 'supplierAccounts'));
    await setDoc(ref, { ...data, connectedVenues: [], createdAt: serverTimestamp() });
    return ref.id;
  }

  async updateAccount(supplierId: string, data: Partial<SupplierAccount>): Promise<void> {
    await updateDoc(doc(this.db, 'supplierAccounts', supplierId), { ...data, updatedAt: serverTimestamp() });
  }

  // ── Catalogue ─────────────────────────────────────────────────────────────
  async getCatalogue(supplierId: string): Promise<CatalogueProduct[]> {
    try {
      const snap = await getDocs(collection(this.db, 'supplierAccounts', supplierId, 'catalogue'));
      return snap.docs.map(d => ({ id: d.id, ...d.data() } as CatalogueProduct));
    } catch { return []; }
  }

  async upsertProduct(supplierId: string, product: Omit<CatalogueProduct, 'id'>): Promise<void> {
    const ref = doc(collection(this.db, 'supplierAccounts', supplierId, 'catalogue'));
    await setDoc(ref, { ...product, updatedAt: serverTimestamp() });
  }

  async updatePrice(supplierId: string, productId: string, price: number): Promise<void> {
    await updateDoc(
      doc(this.db, 'supplierAccounts', supplierId, 'catalogue', productId),
      { price, updatedAt: serverTimestamp() }
    );
    // Notify connected venues of price change
    await this.notifyVenuesPriceChange(supplierId, productId, price);
  }

  async markOutOfStock(supplierId: string, productId: string, available: boolean): Promise<void> {
    await updateDoc(
      doc(this.db, 'supplierAccounts', supplierId, 'catalogue', productId),
      { available, updatedAt: serverTimestamp() }
    );
  }

  // When supplier updates price, flag the product in all connected venues
  private async notifyVenuesPriceChange(supplierId: string, productId: string, newPrice: number): Promise<void> {
    try {
      const account = await this.getAccount(supplierId);
      if (!account?.connectedVenues?.length) return;
      for (const venueId of account.connectedVenues) {
        // Find products in venue that match this supplier + productId
        const venueProductsSnap = await getDocs(
          query(
            collection(this.db, 'venues', venueId, 'products'),
            where('supplierProductId', '==', productId)
          )
        );
        for (const vp of venueProductsSnap.docs) {
          await updateDoc(vp.ref, {
            supplierPriceUpdated: true,
            supplierNewPrice: newPrice,
            supplierPriceUpdatedAt: serverTimestamp(),
          });
        }
      }
    } catch (e) { console.log('[SupplierPortal] notifyVenuesPriceChange error', e); }
  }

  // ── Specials ──────────────────────────────────────────────────────────────
  async getSpecials(supplierId: string): Promise<SupplierSpecial[]> {
    try {
      const snap = await getDocs(collection(this.db, 'supplierAccounts', supplierId, 'specials'));
      return snap.docs.map(d => ({ id: d.id, ...d.data() } as SupplierSpecial));
    } catch { return []; }
  }

  async addSpecial(supplierId: string, special: Omit<SupplierSpecial, 'id'>): Promise<void> {
    const ref = doc(collection(this.db, 'supplierAccounts', supplierId, 'specials'));
    await setDoc(ref, { ...special, createdAt: serverTimestamp() });
  }

  async toggleSpecial(supplierId: string, specialId: string, active: boolean): Promise<void> {
    await updateDoc(doc(this.db, 'supplierAccounts', supplierId, 'specials', specialId), { active });
  }

  // ── Orders ────────────────────────────────────────────────────────────────
  async getOrders(supplierId: string): Promise<SupplierOrderView[]> {
    try {
      const snap = await getDocs(collection(this.db, 'supplierAccounts', supplierId, 'orders'));
      return snap.docs.map(d => ({ id: d.id, ...d.data() } as SupplierOrderView));
    } catch { return []; }
  }

  async acknowledgeOrder(supplierId: string, orderId: string, notes?: string): Promise<void> {
    await updateDoc(
      doc(this.db, 'supplierAccounts', supplierId, 'orders', orderId),
      { status: 'acknowledged', acknowledgedAt: serverTimestamp(), notes: notes || null }
    );
  }

  async updateOrderStatus(supplierId: string, orderId: string, status: SupplierOrderStatus, notes?: string): Promise<void> {
    await updateDoc(
      doc(this.db, 'supplierAccounts', supplierId, 'orders', orderId),
      { status, notes: notes || null, updatedAt: serverTimestamp() }
    );
  }

  // ── Venue connection ──────────────────────────────────────────────────────
  async getActiveSpecialsForVenue(supplierId: string): Promise<SupplierSpecial[]> {
    const all = await this.getSpecials(supplierId);
    const now = new Date();
    return all.filter(s => {
      if (!s.active) return false;
      if (s.validTo && new Date(s.validTo) < now) return false;
      return true;
    });
  }
}

export const SupplierPortalService = new SupplierPortalServiceClass();
