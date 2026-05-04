import * as admin from "firebase-admin";

export interface InvoiceLine {
  name: string;
  qty: number;
  unitPrice?: number;
}

export interface PriceTrackingOptions {
  venueId: string;
  lines: InvoiceLine[];
  supplierId?: string;
  supplierName?: string;
  invoiceId?: string;
}

function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function namesMatch(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const longer = na.length >= nb.length ? na : nb;
  const shorter = na.length < nb.length ? na : nb;
  return shorter.length >= 5 && longer.includes(shorter);
}

export async function trackPriceChanges(opts: PriceTrackingOptions): Promise<{ changed: number; created: number }> {
  const {
    venueId,
    lines,
    supplierId = "",
    supplierName = "",
    invoiceId = `inv_${Date.now()}`,
  } = opts;
  const db = admin.firestore();

  const priced = lines.filter(l => typeof l.unitPrice === "number" && (l.unitPrice as number) > 0);
  if (!priced.length) return { changed: 0, created: 0 };

  const productsSnap = await db.collection(`venues/${venueId}/products`).limit(500).get();
  const products = productsSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));

  const batch = db.batch();
  let ops = 0;
  let changed = 0;
  let created = 0;

  for (const line of priced) {
    if (ops >= 400) break;
    const unitPrice = line.unitPrice as number;
    const matched = products.find(p => namesMatch(p.name || "", line.name));

    if (matched) {
      const existing: number | null = typeof matched.costPrice === "number" ? matched.costPrice : null;
      const productRef = db.doc(`venues/${venueId}/products/${matched.id}`);

      if (existing != null) {
        const pctDiff = Math.abs((unitPrice - existing) / existing);
        if (pctDiff > 0.01) {
          const changePercent = Math.round(((unitPrice - existing) / existing) * 10000) / 100;
          const histRef = productRef.collection("priceHistory").doc();
          batch.set(histRef, {
            date: admin.firestore.FieldValue.serverTimestamp(),
            oldPrice: existing,
            newPrice: unitPrice,
            supplierId,
            supplierName,
            invoiceId,
            changePercent,
            direction: unitPrice > existing ? "increase" : "decrease",
          });
          batch.update(productRef, {
            costPrice: unitPrice,
            priceChanged: true,
            lastPriceChangeAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          ops += 2;
          changed++;
        }
      } else {
        batch.update(productRef, {
          costPrice: unitPrice,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        ops++;
      }
    } else {
      const newRef = db.collection(`venues/${venueId}/products`).doc();
      batch.set(newRef, {
        name: line.name,
        costPrice: unitPrice,
        supplierId,
        supplierName,
        priceChanged: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      ops++;
      created++;
    }
  }

  if (ops > 0) {
    await batch.commit();
    console.log("[trackPriceChanges] committed", { venueId, ops, changed, created, invoiceId });
  }

  return { changed, created };
}
