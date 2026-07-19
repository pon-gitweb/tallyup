import * as admin from "firebase-admin";

export type SupplierMeta = {
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  accountNumber: string | null;
};

// matched carries the existing doc data so commitSupplierResolution avoids a second Firestore read
export type SupplierResolution =
  | { matched: true; supplierId: string; canonicalName: string; score: number; _existingData: Record<string, any> }
  | { matched: false; supplierName: string };

export function normName(s: string): string {
  return (s || "").toLowerCase().trim().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ");
}

function tokenJaccard(a: string, b: string): number {
  const ta = new Set(normName(a).split(" ").filter(Boolean));
  const tb = new Set(normName(b).split(" ").filter(Boolean));
  if (ta.size === 0 && tb.size === 0) return 1;
  if (ta.size === 0 || tb.size === 0) return 0;
  let intersection = 0;
  ta.forEach(t => { if (tb.has(t)) intersection++; });
  return intersection / (ta.size + tb.size - intersection);
}

export async function resolveSupplier(
  db: admin.firestore.Firestore,
  venueId: string,
  meta: SupplierMeta,
): Promise<SupplierResolution> {
  if (!meta.name) return { matched: false, supplierName: "" };
  const suppSnap = await db.collection(`venues/${venueId}/suppliers`).get();
  const candNorm = normName(meta.name);
  let matchedId: string | null = null;
  let matchedDoc: admin.firestore.QueryDocumentSnapshot | null = null;
  let bestScore = 0;
  for (const sd of suppSnap.docs) {
    const sn = normName((sd.data() as any).name || "");
    if (sn === candNorm && sn.length > 0) { matchedId = sd.id; matchedDoc = sd; bestScore = 1.0; break; }
    const sc = tokenJaccard(meta.name, (sd.data() as any).name || "");
    if (sc > bestScore) { bestScore = sc; matchedId = sd.id; matchedDoc = sd; }
  }
  if (matchedId && matchedDoc && bestScore >= 0.85) {
    return {
      matched: true,
      supplierId: matchedId,
      canonicalName: (matchedDoc.data() as any).name || meta.name,
      score: bestScore,
      _existingData: matchedDoc.data() as Record<string, any>,
    };
  }
  return { matched: false, supplierName: meta.name };
}

export async function commitSupplierResolution(
  db: admin.firestore.Firestore,
  venueId: string,
  resolution: SupplierResolution,
  meta: SupplierMeta,
  source: "invoice-csv" | "invoice-pdf" | "invoice-scan",
): Promise<{ supplierId: string; supplierName: string }> {
  if (!resolution.matched && !resolution.supplierName) {
    return { supplierId: "", supplierName: "" };
  }
  if (resolution.matched) {
    const ex = resolution._existingData;
    const upd: any = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
    if (!ex.phone && meta.phone) upd.phone = meta.phone;
    if (!ex.email && meta.email) upd.email = meta.email;
    if (!ex.address && meta.address) upd.address = meta.address;
    if (!ex.accountNumber && meta.accountNumber) upd.accountNumber = meta.accountNumber;
    if (Object.keys(upd).length > 1) {
      await db.doc(`venues/${venueId}/suppliers/${resolution.supplierId}`).update(upd);
    }
    return { supplierId: resolution.supplierId, supplierName: resolution.canonicalName };
  }
  const newRef = await db.collection(`venues/${venueId}/suppliers`).add({
    name: resolution.supplierName,
    phone: meta.phone || null,
    email: meta.email || null,
    address: meta.address || null,
    accountNumber: meta.accountNumber || null,
    isHoldingSupplier: false,
    source,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return { supplierId: newRef.id, supplierName: resolution.supplierName };
}
