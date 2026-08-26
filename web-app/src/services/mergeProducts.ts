/**
 * Merge two venue products — mirrors src/services/products/mergeProducts.ts (mobile).
 * Update both if you change the logic.
 *
 * keepId  — the product that survives and absorbs the other
 * mergeId — the product that gets deactivated (active: false, mergedInto: keepId)
 * dryRun  — when true, counts impacts and returns the summary but writes nothing;
 *            use this to show a confirmation UI before committing.
 */
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore'
import { db } from '../firebase'
import { setPreferredProductSupplier } from './productSuppliers'

export type SameAreaConflict = {
  departmentId: string
  areaId: string
  areaItemId: string
  departmentName: string
  areaName: string
}

export type MergeProductsResult = {
  areaItemsUpdated: number
  sameAreaConflicts: SameAreaConflict[]
  priceHistoryMoved: number
  invoiceHistoryMoved: number
  supplierLinksHandled: number
  fieldsBackfilled: string[]
}

// Fields that are backfilled from mergeId → keepId when the kept product has
// them missing. 'size' is web-app only (recipe-costing string, e.g. "700ml").
const BACKFILL_FIELDS = [
  'costPrice', 'gstPercent', 'unit', 'category', 'packSize', 'supplierName', 'size',
] as const

export async function mergeProducts(
  venueId: string,
  keepId: string,
  mergeId: string,
  dryRun = false,
): Promise<MergeProductsResult> {
  if (keepId === mergeId) throw new Error('mergeProducts: keepId and mergeId must be different')

  let areaItemsUpdated = 0
  const sameAreaConflicts: SameAreaConflict[] = []
  let priceHistoryMoved = 0
  let invoiceHistoryMoved = 0
  let supplierLinksHandled = 0
  const fieldsBackfilled: string[] = []

  // ── 1. Re-point area items ───────────────────────────────────────────────
  // Uses department/area walks instead of collectionGroup() which is blocked
  // by the venue's Firestore security rules.
  const deptsSnap = await getDocs(collection(db, 'venues', venueId, 'departments'))
  for (const deptDoc of deptsSnap.docs) {
    const deptId = deptDoc.id
    const deptName = (deptDoc.data() as Record<string, any>).name || deptId
    const areasSnap = await getDocs(
      collection(db, 'venues', venueId, 'departments', deptId, 'areas')
    )
    for (const areaDoc of areasSnap.docs) {
      const areaId = areaDoc.id
      const areaName = (areaDoc.data() as Record<string, any>).name || areaId
      const itemsCol = collection(
        db, 'venues', venueId, 'departments', deptId, 'areas', areaId, 'items'
      )

      const mergeItemsSnap = await getDocs(query(itemsCol, where('productId', '==', mergeId)))
      if (mergeItemsSnap.empty) continue

      const keepItemsSnap = await getDocs(query(itemsCol, where('productId', '==', keepId)))
      const keepExistsInArea = !keepItemsSnap.empty

      for (const itemDoc of mergeItemsSnap.docs) {
        if (keepExistsInArea) {
          // Both products already exist in this area — re-pointing would create a
          // duplicate entry; flag as a conflict and skip rather than silently collide.
          sameAreaConflicts.push({
            departmentId: deptId,
            areaId,
            areaItemId: itemDoc.id,
            departmentName: deptName,
            areaName,
          })
          // Flag the conflict on the orphaned item so the counting screen can surface
          // it and route a recount to the active survivor. productId is deliberately
          // left unchanged — the resolveProduct chain-walker attributes this item's
          // count to the survivor.
          if (!dryRun) {
            await updateDoc(itemDoc.ref, {
              mergeConflictPending: true,
              mergeConflictSurvivorId: keepId,
              updatedAt: serverTimestamp(),
            })
          }
        } else {
          if (!dryRun) {
            await updateDoc(itemDoc.ref, { productId: keepId, updatedAt: serverTimestamp() })
          }
          areaItemsUpdated++
        }
      }
    }
  }

  // ── 2. Migrate supplier subcollection docs ───────────────────────────────
  const mergeSuppSnap = await getDocs(
    collection(db, 'venues', venueId, 'products', mergeId, 'suppliers')
  )
  for (const mergeSuppDoc of mergeSuppSnap.docs) {
    const suppId = mergeSuppDoc.id
    if (!dryRun) {
      const keepSuppRef = doc(db, 'venues', venueId, 'products', keepId, 'suppliers', suppId)
      const keepSuppSnap = await getDoc(keepSuppRef)
      if (keepSuppSnap.exists()) {
        // Link already exists on keep product — promote to preferred if the merge
        // product had it marked preferred and keep product doesn't.
        const mergeData = mergeSuppDoc.data() as Record<string, any>
        if (mergeData.isPreferred && !(keepSuppSnap.data() as Record<string, any>)?.isPreferred) {
          await setPreferredProductSupplier(venueId, keepId, suppId)
        }
      } else {
        await setDoc(keepSuppRef, mergeSuppDoc.data())
      }
      // Migrate invoiceHistory sub-subcollection before deleting the source supplier doc
      const mergeInvHistSnap = await getDocs(
        collection(db, 'venues', venueId, 'products', mergeId, 'suppliers', suppId, 'invoiceHistory')
      )
      for (const invHistDoc of mergeInvHistSnap.docs) {
        await addDoc(
          collection(db, 'venues', venueId, 'products', keepId, 'suppliers', suppId, 'invoiceHistory'),
          invHistDoc.data(),
        )
        await deleteDoc(invHistDoc.ref)
        invoiceHistoryMoved++
      }
      await deleteDoc(mergeSuppDoc.ref)
    }
    supplierLinksHandled++
  }

  // ── 3. Move priceHistory docs ────────────────────────────────────────────
  const priceHistSnap = await getDocs(
    collection(db, 'venues', venueId, 'products', mergeId, 'priceHistory')
  )
  for (const histDoc of priceHistSnap.docs) {
    if (!dryRun) {
      await addDoc(
        collection(db, 'venues', venueId, 'products', keepId, 'priceHistory'),
        histDoc.data()
      )
      await deleteDoc(histDoc.ref)
    }
    priceHistoryMoved++
  }

  // ── 4. Backfill missing top-level fields onto the kept product ───────────
  const [keepSnap, mergeSnap] = await Promise.all([
    getDoc(doc(db, 'venues', venueId, 'products', keepId)),
    getDoc(doc(db, 'venues', venueId, 'products', mergeId)),
  ])
  const keepData = (keepSnap.data() as Record<string, any>) || {}
  const mergeData = (mergeSnap.data() as Record<string, any>) || {}
  const backfill: Record<string, unknown> = {}
  for (const field of BACKFILL_FIELDS) {
    const keepVal = keepData[field]
    const mergeVal = mergeData[field]
    if ((keepVal == null || keepVal === '') && mergeVal != null && mergeVal !== '') {
      backfill[field] = mergeVal
      fieldsBackfilled.push(field)
    }
  }

  if (!dryRun) {
    if (Object.keys(backfill).length > 0) {
      await updateDoc(doc(db, 'venues', venueId, 'products', keepId), {
        ...backfill,
        updatedAt: serverTimestamp(),
      })
    }
    // Do NOT delete — mark inactive and record where it was merged to.
    await updateDoc(doc(db, 'venues', venueId, 'products', mergeId), {
      active: false,
      mergedInto: keepId,
      updatedAt: serverTimestamp(),
    })
  }

  return { areaItemsUpdated, sameAreaConflicts, priceHistoryMoved, invoiceHistoryMoved, supplierLinksHandled, fieldsBackfilled }
}
