import { getApp } from 'firebase/app';
import {
  getFirestore, collection, getDocs, doc, updateDoc, setDoc, serverTimestamp
} from 'firebase/firestore';

// Case-insensitive name match helper
function normalizeName(s?: string|null) {
  return (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export async function runBackfillLinkAndPars(venueId: string): Promise<{ linkedCount: number; parUpdated: number; unchanged: number; }> {
  const db = getFirestore(getApp());
  let linkedCount = 0;
  let parUpdated = 0;
  let unchanged = 0;

  // Ensure Unassigned supplier exists
  await setDoc(doc(db, 'venues', venueId, 'suppliers', 'unassigned'), {
    name: 'Unassigned', system: true, createdAt: serverTimestamp(),
  }, { merge: true });

  // Load product catalog and build indexes
  const productsSnap = await getDocs(collection(db, 'venues', venueId, 'products'));
  const byName = new Map<string, string>(); // name -> productId
  const productData: Record<string, any> = {};
  productsSnap.forEach(p => {
    const d = p.data() as any;
    const nm = normalizeName(d?.name || d?.productName || '');
    if (nm) byName.set(nm, p.id);
    productData[p.id] = d;
  });

  // Default pars for products missing par/parLevel
  for (const p of productsSnap.docs) {
    const d = p.data() as any;
    const par = Number(d?.par ?? d?.parLevel);
    if (!Number.isFinite(par) || par <= 0) {
      const fallback = Number.isFinite(d?.packSize) && d.packSize > 0 ? Number(d.packSize) : 6;
      await updateDoc(doc(db, 'venues', venueId, 'products', p.id), {
        par: fallback,
        parLevel: fallback,
        parBackfilledAt: serverTimestamp(),
      });
      parUpdated++;
    } else {
      unchanged++;
    }
  }

  // Link area items to products when missing
  const deps = await getDocs(collection(db, 'venues', venueId, 'departments'));
  for (const dep of deps.docs) {
    const areas = await getDocs(collection(db, 'venues', venueId, 'departments', dep.id, 'areas'));
    for (const area of areas.docs) {
      const items = await getDocs(collection(db, 'venues', venueId, 'departments', dep.id, 'areas', area.id, 'items'));
      for (const it of items.docs) {
        const d = it.data() as any;
        const hasLink = !!(d?.productId || d?.productRef?.id || d?.product?.id);
        if (hasLink) { unchanged++; continue; }

        const nm = normalizeName(d?.name || d?.productName || '');
        const matchId = byName.get(nm);
        if (matchId) {
          const prod = productData[matchId] || {};
          await updateDoc(doc(db, 'venues', venueId, 'departments', dep.id, 'areas', area.id, 'items', it.id), {
            productId: matchId,
            supplierId: prod?.supplierId ?? null,
            supplierName: prod?.supplierName ?? null,
            linkBackfilledAt: serverTimestamp(),
          });
          linkedCount++;
        } else {
          unchanged++;
        }
      }
    }
  }

  return { linkedCount, parUpdated, unchanged };
}
