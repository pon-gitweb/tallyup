// Mirrors src/services/productSuppliers.ts (mobile) — if you change the
// supplier-relationship logic, update both files. Separate build targets
// that cannot share code directly.
import { db } from '../firebase'
import {
  collection,
  doc,
  getDocs,
  setDoc,
  updateDoc,
  writeBatch,
  serverTimestamp,
} from 'firebase/firestore'

export type RelationshipType = 'contracted' | 'preferred' | 'alternative' | 'emergency'

export type ProductSupplierLink = {
  supplierId: string
  supplierName: string
  unitCost?: number | null
  caseSize?: number | null
  caseCost?: number | null
  accountNumber?: string | null
  isPreferred: boolean
  relationship: RelationshipType
  contract?: {
    active: boolean
    notes: string
    startDate: any
    endDate: any
    minimumSpend: number | null
    rebateThreshold: number | null
    rebatePercent: number | null
    restrictedCategories: string[]
  } | null
  lastOrderedAt?: any
  lastInvoiceAt?: any
  lastInvoicePrice?: number | null
  addedAt?: any
  addedBy?: string
}

export async function listProductSuppliers(
  venueId: string,
  productId: string,
): Promise<ProductSupplierLink[]> {
  const snap = await getDocs(collection(db, 'venues', venueId, 'products', productId, 'suppliers'))
  return snap.docs.map(d => d.data() as ProductSupplierLink)
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
  )
}

export async function setPreferredProductSupplier(
  venueId: string,
  productId: string,
  newPreferredSupplierId: string,
): Promise<void> {
  const linksSnap = await getDocs(
    collection(db, 'venues', venueId, 'products', productId, 'suppliers'),
  )
  const batch = writeBatch(db)
  let preferredName = ''
  linksSnap.docs.forEach(d => {
    const isNew = d.id === newPreferredSupplierId
    batch.update(d.ref, { isPreferred: isNew })
    if (isNew) preferredName = (d.data() as any).supplierName || ''
  })
  batch.update(doc(db, 'venues', venueId, 'products', productId), {
    primarySupplierId: newPreferredSupplierId,
    primarySupplierName: preferredName,
    supplierUpdatedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  await batch.commit()
}
