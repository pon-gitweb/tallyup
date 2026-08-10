// Mirrors src/services/productSuppliers.ts (mobile) — if you change the
// supplier-relationship logic, update both files. Separate build targets
// that cannot share code directly.
import { db } from '../firebase'
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

export async function removeProductSupplier(
  venueId: string,
  productId: string,
  supplierId: string,
): Promise<void> {
  await deleteDoc(doc(db, 'venues', venueId, 'products', productId, 'suppliers', supplierId))
  const productRef = doc(db, 'venues', venueId, 'products', productId)
  const snap = await getDoc(productRef)
  if (snap.exists() && (snap.data() as any)?.primarySupplierId === supplierId) {
    await updateDoc(productRef, {
      primarySupplierId: null,
      primarySupplierName: '',
      supplierUpdatedAt: serverTimestamp(),
    })
  }
}

/**
 * Merge two suppliers — mirrors mergeSuppliers in
 * src/services/productSuppliers.ts (mobile). Update both if you change the logic.
 *
 * keepId  — the supplier that survives
 * mergeId — the supplier to absorb; caller must hard-delete it afterwards as a
 *            separate step (see mobile's SuppliersScreen.tsx: mergeSuppliers then
 *            deleteSupplierById in sequence)
 * dryRun  — when true, counts affected products but writes nothing
 */
export async function mergeSuppliers(
  venueId: string,
  keepId: string,
  mergeId: string,
  dryRun = false,
): Promise<{ productsUpdated: number }> {
  if (keepId === mergeId) throw new Error('mergeSuppliers: keepId and mergeId must be different')

  let keepSupplierName = ''
  if (!dryRun) {
    const keepSnap = await getDoc(doc(db, 'venues', venueId, 'suppliers', keepId))
    keepSupplierName = (keepSnap.data() as Record<string, any>)?.name || ''
  }

  const productsSnap = await getDocs(collection(db, 'venues', venueId, 'products'))
  let productsUpdated = 0

  for (const productDoc of productsSnap.docs) {
    const data = productDoc.data() as Record<string, any>
    const productId = productDoc.id

    const topLevelUpdates: Record<string, any> = {}
    if (data.supplierId === mergeId) {
      topLevelUpdates.supplierId = keepId
      topLevelUpdates.supplierName = keepSupplierName
    }
    if (data.primarySupplierId === mergeId) {
      topLevelUpdates.primarySupplierId = keepId
      topLevelUpdates.primarySupplierName = keepSupplierName
    }
    let touched = Object.keys(topLevelUpdates).length > 0

    const mergeDocRef = doc(db, 'venues', venueId, 'products', productId, 'suppliers', mergeId)
    const mergeDocSnap = await getDoc(mergeDocRef)

    if (mergeDocSnap.exists()) {
      if (!dryRun) {
        const mergeData = mergeDocSnap.data() as Record<string, any>
        const keepDocRef = doc(db, 'venues', venueId, 'products', productId, 'suppliers', keepId)
        const keepDocSnap = await getDoc(keepDocRef)
        if (keepDocSnap.exists()) {
          // Link already exists on keep product — promote preferred status if
          // the merge supplier was preferred and the keep supplier is not.
          if (mergeData.isPreferred && !(keepDocSnap.data() as Record<string, any>)?.isPreferred) {
            await setPreferredProductSupplier(venueId, productId, keepId)
            // setPreferredProductSupplier already writes primarySupplierId; drop
            // them from topLevelUpdates to avoid a redundant / conflicting write.
            delete topLevelUpdates.primarySupplierId
            delete topLevelUpdates.primarySupplierName
          }
        } else {
          await setDoc(keepDocRef, {
            ...mergeData,
            supplierId: keepId,
            supplierName: keepSupplierName || mergeData.supplierName,
          })
        }
        await deleteDoc(mergeDocRef)
      }
      touched = true
    }

    if (!dryRun && Object.keys(topLevelUpdates).length > 0) {
      await updateDoc(productDoc.ref, { ...topLevelUpdates, updatedAt: serverTimestamp() })
    }

    if (touched) productsUpdated++
  }

  return { productsUpdated }
}
