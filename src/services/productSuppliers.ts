// @ts-nocheck
import { db } from './firebase';
import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  serverTimestamp,
} from 'firebase/firestore';

export type RelationshipType = 'contracted' | 'preferred' | 'alternative' | 'emergency';

export type ProductSupplierLink = {
  supplierId: string;
  supplierName: string;
  unitCost?: number | null;
  caseSize?: number | null;
  caseCost?: number | null;
  accountNumber?: string | null;
  isPreferred: boolean;
  relationship: RelationshipType;
  contract?: {
    active: boolean;
    notes: string;
    startDate: any;
    endDate: any;
    minimumSpend: number | null;
    rebateThreshold: number | null;
    rebatePercent: number | null;
    restrictedCategories: string[];
  } | null;
  lastOrderedAt?: any;
  lastInvoiceAt?: any;
  lastInvoicePrice?: number | null;
  addedAt?: any;
  addedBy?: string;
};

export async function listProductSuppliers(
  venueId: string,
  productId: string,
): Promise<ProductSupplierLink[]> {
  const snap = await getDocs(collection(db, 'venues', venueId, 'products', productId, 'suppliers'));
  return snap.docs.map(d => d.data() as ProductSupplierLink);
}

export async function upsertProductSupplier(
  venueId: string,
  productId: string,
  supplierId: string,
  data: Partial<ProductSupplierLink>,
): Promise<void> {
  await setDoc(
    doc(db, 'venues', venueId, 'products', productId, 'suppliers', supplierId),
    { supplierId, ...data, addedAt: serverTimestamp() },
    { merge: true },
  );
}

export async function setPreferredProductSupplier(
  venueId: string,
  productId: string,
  newPreferredSupplierId: string,
): Promise<void> {
  const linksSnap = await getDocs(
    collection(db, 'venues', venueId, 'products', productId, 'suppliers'),
  );
  const batch = writeBatch(db);
  let preferredName = '';
  linksSnap.docs.forEach(d => {
    const isNew = d.id === newPreferredSupplierId;
    batch.update(d.ref, { isPreferred: isNew });
    if (isNew) preferredName = (d.data() as any).supplierName || '';
  });
  batch.update(doc(db, 'venues', venueId, 'products', productId), {
    primarySupplierId: newPreferredSupplierId,
    primarySupplierName: preferredName,
    supplierUpdatedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
}

export async function removeProductSupplier(
  venueId: string,
  productId: string,
  supplierId: string,
): Promise<void> {
  await deleteDoc(doc(db, 'venues', venueId, 'products', productId, 'suppliers', supplierId));
  const productRef = doc(db, 'venues', venueId, 'products', productId);
  const snap = await getDoc(productRef);
  if (snap.exists() && (snap.data() as any)?.primarySupplierId === supplierId) {
    await updateDoc(productRef, {
      primarySupplierId: null,
      primarySupplierName: '',
      supplierUpdatedAt: serverTimestamp(),
    });
  }
}

export async function mergeSuppliers(
  venueId: string,
  keepId: string,
  mergeId: string,
  dryRun = false,
): Promise<{ productsUpdated: number }> {
  if (keepId === mergeId) throw new Error('mergeSuppliers: keepId and mergeId must be different');

  let keepSupplierName = '';
  if (!dryRun) {
    const keepSnap = await getDoc(doc(db, 'venues', venueId, 'suppliers', keepId));
    keepSupplierName = (keepSnap.data() as any)?.name || '';
  }

  const productsSnap = await getDocs(collection(db, 'venues', venueId, 'products'));
  let productsUpdated = 0;

  for (const productDoc of productsSnap.docs) {
    const data = productDoc.data() as any;
    const productId = productDoc.id;

    const topLevelUpdates: Record<string, any> = {};
    if (data.supplierId === mergeId) {
      topLevelUpdates.supplierId = keepId;
      topLevelUpdates.supplierName = keepSupplierName;
    }
    if (data.primarySupplierId === mergeId) {
      topLevelUpdates.primarySupplierId = keepId;
      topLevelUpdates.primarySupplierName = keepSupplierName;
    }
    let touched = Object.keys(topLevelUpdates).length > 0;

    const mergeDocRef = doc(db, 'venues', venueId, 'products', productId, 'suppliers', mergeId);
    const mergeDocSnap = await getDoc(mergeDocRef);

    if (mergeDocSnap.exists()) {
      if (!dryRun) {
        const mergeData = mergeDocSnap.data() as any;
        const keepDocRef = doc(db, 'venues', venueId, 'products', productId, 'suppliers', keepId);
        const keepDocSnap = await getDoc(keepDocRef);
        if (keepDocSnap.exists()) {
          if (mergeData.isPreferred && !(keepDocSnap.data() as any)?.isPreferred) {
            await setPreferredProductSupplier(venueId, productId, keepId);
            delete topLevelUpdates.primarySupplierId;
            delete topLevelUpdates.primarySupplierName;
          }
        } else {
          await setDoc(keepDocRef, { ...mergeData, supplierId: keepId, supplierName: keepSupplierName || mergeData.supplierName });
        }
        await deleteDoc(mergeDocRef);
      }
      touched = true;
    }

    if (!dryRun && Object.keys(topLevelUpdates).length > 0) {
      await updateDoc(productDoc.ref, { ...topLevelUpdates, updatedAt: serverTimestamp() });
    }

    if (touched) productsUpdated++;
  }

  return { productsUpdated };
}

// One-time migration: for products with supplierId, seed the supplier subcollection.
// Idempotent — skips products already migrated. Module-level flag avoids re-running per session.
let _migrationAttempted = false;

export async function runSupplierMigration(venueId: string): Promise<{ migrated: number }> {
  if (_migrationAttempted) return { migrated: 0 };
  _migrationAttempted = true;
  let migrated = 0;
  try {
    const productsSnap = await getDocs(collection(db, 'venues', venueId, 'products'));
    for (const d of productsSnap.docs) {
      const data = d.data() as any;
      const sId: string | null = data.supplierId || null;
      if (!sId || data.primarySupplierId) continue;
      const linksSnap = await getDocs(
        collection(db, 'venues', venueId, 'products', d.id, 'suppliers'),
      );
      if (!linksSnap.empty) continue;
      await setDoc(
        doc(db, 'venues', venueId, 'products', d.id, 'suppliers', sId),
        {
          supplierId: sId,
          supplierName: data.supplierName || '',
          unitCost: data.costPrice ?? null,
          caseSize: data.caseSize ?? null,
          caseCost: null,
          isPreferred: true,
          relationship: 'preferred',
          lastInvoicePrice: data.lastInvoicePrice ?? null,
          addedAt: serverTimestamp(),
          addedBy: 'migration',
        },
      );
      await updateDoc(d.ref, {
        primarySupplierId: sId,
        primarySupplierName: data.supplierName || '',
        supplierCount: 1,
      });
      migrated++;
    }
  } catch {
    _migrationAttempted = false; // allow retry on next session
  }
  return { migrated };
}
