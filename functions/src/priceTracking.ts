import * as admin from "firebase-admin";

export interface InvoiceLine {
  name: string;
  qty: number;
  unitPrice?: number;
  caseSize?: number | null;
}

export interface PriceTrackingOptions {
  venueId: string;
  lines: InvoiceLine[];
  supplierId?: string;
  supplierName?: string;
  invoiceId?: string;
  invoiceDocId?: string;
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

export interface ChangedLineDetail {
  productId: string;
  productName: string;
  oldPrice: number;
  newPrice: number;
  changePercent: number;
  direction: "increase" | "decrease";
  qty: number;
  caseSize: number | null;
}

export async function trackPriceChanges(opts: PriceTrackingOptions): Promise<{ changed: number; created: number; productMap: Record<string, string>; changedLines: ChangedLineDetail[] }> {
  const {
    venueId,
    lines,
    supplierId = "",
    supplierName = "",
    invoiceId = `inv_${Date.now()}`,
    invoiceDocId,
  } = opts;
  const cleanSupplierId = supplierId && supplierId.trim() ? supplierId.trim() : null;
  const cleanSupplierName = supplierName && supplierName.trim() ? supplierName.trim() : null;
  const db = admin.firestore();

  // Reject lines with no price, zero price, or suspiciously high prices (likely totals, not unit prices)
  const priced = lines.filter(l =>
    typeof l.unitPrice === "number" &&
    (l.unitPrice as number) > 0 &&
    (l.unitPrice as number) < 10000
  );
  if (!priced.length) return { changed: 0, created: 0, productMap: {}, changedLines: [] };

  const productsSnap = await db.collection(`venues/${venueId}/products`).limit(500).get();
  const products = productsSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));

  const batch = db.batch();
  let ops = 0;
  let changed = 0;
  let created = 0;
  const productMap: Record<string, string> = {};
  const changedLines: ChangedLineDetail[] = [];

  for (const line of priced) {
    if (ops >= 400) break;
    const unitPrice = line.unitPrice as number;
    const matched = products.find(p => namesMatch(p.name || "", line.name));

    // Computed caseSize fields (only if caseSize is a valid positive number)
    const cs = typeof line.caseSize === "number" && line.caseSize > 0 ? line.caseSize : null;
    const caseSizeFields = cs
      ? { caseSize: cs, unitCost: unitPrice / cs, caseCost: unitPrice }
      : {};

    if (matched) {
      productMap[line.name] = matched.id;
      const existing: number | null = typeof matched.costPrice === "number" ? matched.costPrice : null;
      const productRef = db.doc(`venues/${venueId}/products/${matched.id}`);

      if (existing != null) {
        const pctDiff = Math.abs((unitPrice - existing) / existing);
        if (pctDiff > 0.01) {
          // Price changed — write history + update costPrice
          const changePercent = Math.round(((unitPrice - existing) / existing) * 10000) / 100;
          changedLines.push({
            productId: matched.id,
            productName: matched.name || line.name,
            oldPrice: existing,
            newPrice: unitPrice,
            changePercent,
            direction: unitPrice > existing ? "increase" : "decrease",
            qty: line.qty,
            caseSize: cs,
          });
          const histRef = productRef.collection("priceHistory").doc();
          batch.set(histRef, {
            date: admin.firestore.FieldValue.serverTimestamp(),
            oldPrice: existing,
            newPrice: unitPrice,
            supplierId: cleanSupplierId,
            supplierName: cleanSupplierName,
            invoiceId,
            changePercent,
            direction: unitPrice > existing ? "increase" : "decrease",
          });
          batch.update(productRef, {
            costPrice: unitPrice,
            costPriceUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
            costPriceSource: "invoice",
            lastInvoicePrice: unitPrice,
            lastInvoicePriceAt: admin.firestore.FieldValue.serverTimestamp(),
            priceChanged: true,
            lastPriceChangeAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            ...caseSizeFields,
          });
          ops += 2;
          changed++;
        } else {
          // Same price — just update the invoice timestamp
          batch.update(productRef, {
            lastInvoicePrice: unitPrice,
            lastInvoicePriceAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            ...caseSizeFields,
          });
          ops++;
        }
      } else {
        // No existing costPrice — set it for the first time; write initial history entry
        const initHistRef = productRef.collection("priceHistory").doc();
        batch.set(initHistRef, {
          date: admin.firestore.FieldValue.serverTimestamp(),
          oldPrice: null,
          newPrice: unitPrice,
          supplierId: cleanSupplierId,
          supplierName: cleanSupplierName,
          invoiceId,
          changePercent: null,
          direction: "initial",
          note: "Initial price set from invoice",
        });
        batch.update(productRef, {
          costPrice: unitPrice,
          costPriceUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
          costPriceSource: "invoice",
          lastInvoicePrice: unitPrice,
          lastInvoicePriceAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          ...caseSizeFields,
        });
        ops += 2;
      }
    } else {
      // Secondary dedup check before creating — catch near-duplicates
      // that namesMatch missed (e.g. "Heineken 330ml" vs "Heineken Lager 330ml")
      const normLine = normalizeName(line.name);
      const nearDuplicate = products.find(p => {
        const np = normalizeName(p.name || '');
        if (!np || !normLine || np.length < 4 || normLine.length < 4) return false;
        if (np.includes(normLine) || normLine.includes(np)) return true;
        // Levenshtein-lite: if strings share 80%+ of characters in order
        const shorter = np.length < normLine.length ? np : normLine;
        const longer = np.length >= normLine.length ? np : normLine;
        let si = 0;
        let matches = 0;
        for (let li = 0; li < longer.length && si < shorter.length; li++) {
          if (longer[li] === shorter[si]) { matches++; si++; }
        }
        return matches / shorter.length >= 0.85;
      });

      if (nearDuplicate) {
        // Near-duplicate found — update price on existing product instead of creating
        console.log(`[trackPriceChanges] near-duplicate found: "${line.name}" → "${nearDuplicate.name}" (${nearDuplicate.id})`);
        productMap[line.name] = nearDuplicate.id;
        const productRef = db.doc(`venues/${venueId}/products/${nearDuplicate.id}`);
        const existing: number | null = typeof nearDuplicate.costPrice === 'number' ? nearDuplicate.costPrice : null;
        if (existing != null && Math.abs((unitPrice - existing) / existing) > 0.01) {
          batch.update(productRef, {
            costPrice: unitPrice,
            costPriceUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
            lastInvoicePrice: unitPrice,
            lastInvoicePriceAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            ...caseSizeFields,
          });
          ops++;
          changed++;
        } else if (existing == null) {
          batch.update(productRef, {
            costPrice: unitPrice,
            costPriceUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
            lastInvoicePrice: unitPrice,
            lastInvoicePriceAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            ...caseSizeFields,
          });
          ops++;
        }
      } else {
        // Genuinely new product — create it
        const newRef = db.collection(`venues/${venueId}/products`).doc();
        productMap[line.name] = newRef.id;
        batch.set(newRef, {
          name: line.name,
          costPrice: unitPrice,
          costPriceUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
          costPriceSource: 'invoice',
          lastInvoicePrice: unitPrice,
          lastInvoicePriceAt: admin.firestore.FieldValue.serverTimestamp(),
          supplierId: cleanSupplierId,
          supplierName: cleanSupplierName,
          inductionSource: 'invoice-price-tracking',
          inductionStatus: 'pending',
          priceChanged: false,
          ...caseSizeFields,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        ops++;
        created++;
        console.log(`[trackPriceChanges] new product created: "${line.name}"`);
      }
    }
  }

  if (ops > 0) {
    await batch.commit();
    console.log("[trackPriceChanges] committed", { venueId, ops, changed, created, invoiceId });
  }

  // After batch.commit() — link area items to resolved products and update costPrice
  if (Object.keys(productMap).length > 0) {
    try {
      const depsSnap = await db.collection(`venues/${venueId}/departments`).get();
      const itemBatch = db.batch();
      let itemOps = 0;

      for (const dep of depsSnap.docs) {
        const areasSnap = await db.collection(`venues/${venueId}/departments/${dep.id}/areas`).get();
        for (const area of areasSnap.docs) {
          const itemsSnap = await db
            .collection(`venues/${venueId}/departments/${dep.id}/areas/${area.id}/items`)
            .get();
          for (const itemDoc of itemsSnap.docs) {
            if (itemOps >= 400) break;
            const item = itemDoc.data() as any;
            const itemName = (item.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');

            for (const [lineName, resolvedProductId] of Object.entries(productMap)) {
              const normLine = lineName.toLowerCase().replace(/[^a-z0-9]/g, '');
              if (itemName && normLine && (itemName === normLine || itemName.includes(normLine) || normLine.includes(itemName))) {
                const prodSnap = await db.doc(`venues/${venueId}/products/${resolvedProductId}`).get();
                const resolvedCostPrice = (prodSnap.data() as any)?.costPrice ?? null;

                const updates: any = {
                  updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                };
                if (!item.productId && resolvedProductId) {
                  updates.productId = resolvedProductId;
                }
                if (resolvedCostPrice && !item.costPrice) {
                  updates.costPrice = resolvedCostPrice;
                  updates.costPriceSource = 'invoice';
                  updates.costPriceUpdatedAt = admin.firestore.FieldValue.serverTimestamp();
                }
                if (Object.keys(updates).length > 1) {
                  itemBatch.update(itemDoc.ref, updates);
                  itemOps++;
                }
                break;
              }
            }
          }
        }
      }

      if (itemOps > 0) {
        await itemBatch.commit();
        console.log(`[trackPriceChanges] linked ${itemOps} area item(s) to venue products`);
      }
    } catch (e: any) {
      console.log('[trackPriceChanges] area item linking failed (non-fatal):', e?.message);
    }
  }

  // FIX 3: Write supplier links to product/suppliers subcollection (best-effort)
  if (cleanSupplierId) {
    for (const line of priced) {
      const unitPrice = line.unitPrice as number;
      const matched = products.find(p => namesMatch(p.name || "", line.name));
      if (!matched) continue;
      const cs = typeof line.caseSize === "number" && line.caseSize > 0 ? line.caseSize : null;
      const unitCost = cs ? unitPrice / cs : unitPrice;
      const supplierRef = db.doc(`venues/${venueId}/products/${matched.id}/suppliers/${cleanSupplierId}`);
      try {
        const snap = await supplierRef.get();
        if (!snap.exists) {
          const hasPreferred = !!(matched.primarySupplierId);
          await supplierRef.set({
            supplierId: cleanSupplierId,
            supplierName: cleanSupplierName,
            unitCost,
            caseSize: cs,
            caseCost: cs ? unitPrice : null,
            isPreferred: !hasPreferred,
            relationship: "alternative",
            agreedPrice: unitCost,
            agreedPriceSetAt: admin.firestore.FieldValue.serverTimestamp(),
            agreedPriceSource: "invoice",
            lastInvoiceAt: admin.firestore.FieldValue.serverTimestamp(),
            lastInvoicePrice: unitPrice,
            addedAt: admin.firestore.FieldValue.serverTimestamp(),
            addedBy: "invoice-import",
          });
          if (!hasPreferred) {
            await db.doc(`venues/${venueId}/products/${matched.id}`).update({
              primarySupplierId: cleanSupplierId,
              primarySupplierName: cleanSupplierName,
            });
          }
        } else {
          await supplierRef.update({
            unitCost,
            caseSize: cs,
            lastInvoiceAt: admin.firestore.FieldValue.serverTimestamp(),
            lastInvoicePrice: unitPrice,
          });
        }
      } catch (e: any) {
        console.log("[trackPriceChanges] supplier link error", matched.id, e?.message);
      }
    }
  }

  return { changed, created, productMap, changedLines };
}

// ---------------------------------------------------------------------------
// Propose / commit split — replaces trackPriceChanges once callers are migrated
// ---------------------------------------------------------------------------

export type ProposedAction =
  | {
      id: string;
      type: "priceChange";
      productId: string;
      productName: string;
      lineName: string;
      oldPrice: number;
      newPrice: number;
      changePercent: number;
      direction: "increase" | "decrease";
      qty: number;
      caseSize: number | null;
    }
  | {
      id: string;
      type: "nearDuplicateMatch";
      candidateProductId: string;
      candidateProductName: string;
      lineName: string;
      existingPrice: number | null;
      newPrice: number;
      qty: number;
      caseSize: number | null;
    }
  | {
      id: string;
      type: "newProduct";
      lineName: string;
      unitPrice: number | null;
      qty: number;
      caseSize: number | null;
      supplierId: string | null;
      supplierName: string | null;
    }
  | {
      id: string;
      type: "supplierLink";
      productId: string;
      productName: string;
      supplierId: string;
      supplierName: string | null;
      unitCost: number;
      caseSize: number | null;
      wouldBecomePreferred: boolean;
    };

async function applyAreaItemLinking(
  db: FirebaseFirestore.Firestore,
  venueId: string,
  productMap: Record<string, string>,
  logPrefix: string,
): Promise<number> {
  if (Object.keys(productMap).length === 0) return 0;
  try {
    const depsSnap = await db.collection(`venues/${venueId}/departments`).get();
    const itemBatch = db.batch();
    let itemOps = 0;

    for (const dep of depsSnap.docs) {
      const areasSnap = await db
        .collection(`venues/${venueId}/departments/${dep.id}/areas`)
        .get();
      for (const area of areasSnap.docs) {
        const itemsSnap = await db
          .collection(`venues/${venueId}/departments/${dep.id}/areas/${area.id}/items`)
          .get();
        for (const itemDoc of itemsSnap.docs) {
          if (itemOps >= 400) break;
          const item = itemDoc.data() as any;
          const itemName = (item.name || "").toLowerCase().replace(/[^a-z0-9]/g, "");

          for (const [lineName, resolvedProductId] of Object.entries(productMap)) {
            const normLine = lineName.toLowerCase().replace(/[^a-z0-9]/g, "");
            if (
              itemName && normLine &&
              (itemName === normLine || itemName.includes(normLine) || normLine.includes(itemName))
            ) {
              const prodSnap = await db.doc(`venues/${venueId}/products/${resolvedProductId}`).get();
              const resolvedCostPrice = (prodSnap.data() as any)?.costPrice ?? null;

              const updates: any = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
              if (!item.productId && resolvedProductId) {
                updates.productId = resolvedProductId;
              }
              if (resolvedCostPrice && !item.costPrice) {
                updates.costPrice = resolvedCostPrice;
                updates.costPriceSource = "invoice";
                updates.costPriceUpdatedAt = admin.firestore.FieldValue.serverTimestamp();
              }
              if (Object.keys(updates).length > 1) {
                itemBatch.update(itemDoc.ref, updates);
                itemOps++;
              }
              break;
            }
          }
        }
      }
    }

    if (itemOps > 0) {
      await itemBatch.commit();
      console.log(`[${logPrefix}] linked ${itemOps} area item(s) to venue products`);
    }
    return itemOps;
  } catch (e: any) {
    console.log(`[${logPrefix}] area item linking failed (non-fatal):`, e?.message);
    return 0;
  }
}

export async function proposeInvoiceChanges(opts: PriceTrackingOptions): Promise<{
  autoApplied: { linked: number };
  proposals: ProposedAction[];
  autoProductMap: Record<string, string>;
}> {
  const {
    venueId,
    lines,
    supplierId = "",
    supplierName = "",
    invoiceId = `inv_${Date.now()}`,
  } = opts;
  const cleanSupplierId = supplierId && supplierId.trim() ? supplierId.trim() : null;
  const cleanSupplierName = supplierName && supplierName.trim() ? supplierName.trim() : null;
  const db = admin.firestore();

  const priced = lines.filter(l =>
    typeof l.unitPrice === "number" &&
    (l.unitPrice as number) > 0 &&
    (l.unitPrice as number) < 10000
  );
  if (!priced.length) return { autoApplied: { linked: 0 }, proposals: [], autoProductMap: {} };

  const productsSnap = await db.collection(`venues/${venueId}/products`).limit(500).get();
  const products = productsSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));

  const batch = db.batch();
  let ops = 0;
  const proposals: ProposedAction[] = [];
  // Confident namesMatch lines — fed to area-item linking even when price write waits
  const autoProductMap: Record<string, string> = {};

  for (const line of priced) {
    if (ops >= 400) break;
    const unitPrice = line.unitPrice as number;
    const matched = products.find(p => namesMatch(p.name || "", line.name));

    const cs = typeof line.caseSize === "number" && line.caseSize > 0 ? line.caseSize : null;
    const caseSizeFields = cs
      ? { caseSize: cs, unitCost: unitPrice / cs, caseCost: unitPrice }
      : {};

    if (matched) {
      // Trusted product ID — queue for area-item linking regardless of price outcome
      autoProductMap[line.name] = matched.id;
      const existing: number | null = typeof matched.costPrice === "number" ? matched.costPrice : null;
      const productRef = db.doc(`venues/${venueId}/products/${matched.id}`);

      if (existing != null) {
        const pctDiff = Math.abs((unitPrice - existing) / existing);
        if (pctDiff > 0.01) {
          // Price change — waits for user confirmation
          const changePercent = Math.round(((unitPrice - existing) / existing) * 10000) / 100;
          proposals.push({
            id: `${invoiceId}:priceChange:${matched.id}`,
            type: "priceChange",
            productId: matched.id,
            productName: matched.name || line.name,
            lineName: line.name,
            oldPrice: existing,
            newPrice: unitPrice,
            changePercent,
            direction: unitPrice > existing ? "increase" : "decrease",
            qty: line.qty,
            caseSize: cs,
          });
        } else {
          // Same price — automatic touch (no meaningful change)
          batch.update(productRef, {
            lastInvoicePrice: unitPrice,
            lastInvoicePriceAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            ...caseSizeFields,
          });
          ops++;
        }
      } else {
        // First-time price set — automatic
        const initHistRef = productRef.collection("priceHistory").doc();
        batch.set(initHistRef, {
          date: admin.firestore.FieldValue.serverTimestamp(),
          oldPrice: null,
          newPrice: unitPrice,
          supplierId: cleanSupplierId,
          supplierName: cleanSupplierName,
          invoiceId,
          changePercent: null,
          direction: "initial",
          note: "Initial price set from invoice",
        });
        batch.update(productRef, {
          costPrice: unitPrice,
          costPriceUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
          costPriceSource: "invoice",
          lastInvoicePrice: unitPrice,
          lastInvoicePriceAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          ...caseSizeFields,
        });
        ops += 2;
      }
    } else {
      const normLine = normalizeName(line.name);
      const nearDuplicate = products.find(p => {
        const np = normalizeName(p.name || "");
        if (!np || !normLine || np.length < 4 || normLine.length < 4) return false;
        if (np.includes(normLine) || normLine.includes(np)) return true;
        const shorter = np.length < normLine.length ? np : normLine;
        const longer = np.length >= normLine.length ? np : normLine;
        let si = 0;
        let matches = 0;
        for (let li = 0; li < longer.length && si < shorter.length; li++) {
          if (longer[li] === shorter[si]) { matches++; si++; }
        }
        return matches / shorter.length >= 0.85;
      });

      if (nearDuplicate) {
        // Near-duplicate — match AND price wait together (wrong match = wrong product ID)
        const existing: number | null =
          typeof nearDuplicate.costPrice === "number" ? nearDuplicate.costPrice : null;
        proposals.push({
          id: `${invoiceId}:nearDuplicateMatch:${normalizeName(line.name)}`,
          type: "nearDuplicateMatch",
          candidateProductId: nearDuplicate.id,
          candidateProductName: nearDuplicate.name || "",
          lineName: line.name,
          existingPrice: existing,
          newPrice: unitPrice,
          qty: line.qty,
          caseSize: cs,
        });
      } else {
        // Genuinely new product — waits for user confirmation
        proposals.push({
          id: `${invoiceId}:newProduct:${normalizeName(line.name)}`,
          type: "newProduct",
          lineName: line.name,
          unitPrice,
          qty: line.qty,
          caseSize: cs,
          supplierId: cleanSupplierId,
          supplierName: cleanSupplierName,
        });
      }
    }
  }

  // Commit auto-applied writes (same-price touches + first-time prices)
  if (ops > 0) {
    await batch.commit();
    console.log("[proposeInvoiceChanges] auto-committed", { venueId, ops, invoiceId });
  }

  // Area-item linking for all confident namesMatch lines — runs immediately
  const linked = await applyAreaItemLinking(db, venueId, autoProductMap, "proposeInvoiceChanges");

  // Supplier links: existing links auto-update; new links become proposals
  if (cleanSupplierId) {
    for (const line of priced) {
      const unitPrice = line.unitPrice as number;
      const matched = products.find(p => namesMatch(p.name || "", line.name));
      if (!matched) continue;
      const cs = typeof line.caseSize === "number" && line.caseSize > 0 ? line.caseSize : null;
      const unitCost = cs ? unitPrice / cs : unitPrice;
      const supplierRef = db.doc(
        `venues/${venueId}/products/${matched.id}/suppliers/${cleanSupplierId}`
      );
      try {
        const snap = await supplierRef.get();
        if (!snap.exists) {
          proposals.push({
            id: `${invoiceId}:supplierLink:${matched.id}:${cleanSupplierId}`,
            type: "supplierLink",
            productId: matched.id,
            productName: matched.name || line.name,
            supplierId: cleanSupplierId,
            supplierName: cleanSupplierName,
            unitCost,
            caseSize: cs,
            wouldBecomePreferred: !matched.primarySupplierId,
          });
        } else {
          await supplierRef.update({
            unitCost,
            caseSize: cs,
            lastInvoiceAt: admin.firestore.FieldValue.serverTimestamp(),
            lastInvoicePrice: unitPrice,
          });
        }
      } catch (e: any) {
        console.log("[proposeInvoiceChanges] supplier link error", matched.id, e?.message);
      }
    }
  }

  return { autoApplied: { linked }, proposals, autoProductMap };
}

export async function commitInvoiceChanges(
  venueId: string,
  accepted: ProposedAction[],
  context: { supplierId?: string; supplierName?: string; invoiceId?: string },
): Promise<{ changed: number; created: number; productMap: Record<string, string> }> {
  const db = admin.firestore();
  const cleanSupplierId = context.supplierId?.trim() || null;
  const cleanSupplierName = context.supplierName?.trim() || null;
  const invoiceId = context.invoiceId || `inv_${Date.now()}`;

  const batch = db.batch();
  let ops = 0;
  let changed = 0;
  let created = 0;
  // lineName → productId for lines that get a real product ID for the first time here
  const newlyResolvedMap: Record<string, string> = {};

  for (const proposal of accepted) {
    if (ops >= 400) break;

    if (proposal.type === "priceChange") {
      const productRef = db.doc(`venues/${venueId}/products/${proposal.productId}`);
      const cs = proposal.caseSize;
      const caseSizeFields = cs
        ? { caseSize: cs, unitCost: proposal.newPrice / cs, caseCost: proposal.newPrice }
        : {};
      const histRef = productRef.collection("priceHistory").doc();
      batch.set(histRef, {
        date: admin.firestore.FieldValue.serverTimestamp(),
        oldPrice: proposal.oldPrice,
        newPrice: proposal.newPrice,
        supplierId: cleanSupplierId,
        supplierName: cleanSupplierName,
        invoiceId,
        changePercent: proposal.changePercent,
        direction: proposal.direction,
      });
      batch.update(productRef, {
        costPrice: proposal.newPrice,
        costPriceUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
        costPriceSource: "invoice",
        lastInvoicePrice: proposal.newPrice,
        lastInvoicePriceAt: admin.firestore.FieldValue.serverTimestamp(),
        priceChanged: true,
        lastPriceChangeAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        ...caseSizeFields,
      });
      ops += 2;
      changed++;
      // Area-item linking for this product already ran in proposeInvoiceChanges

    } else if (proposal.type === "nearDuplicateMatch") {
      const productRef = db.doc(`venues/${venueId}/products/${proposal.candidateProductId}`);
      const cs = proposal.caseSize;
      const caseSizeFields = cs
        ? { caseSize: cs, unitCost: proposal.newPrice / cs, caseCost: proposal.newPrice }
        : {};

      if (proposal.existingPrice != null) {
        const pctDiff = Math.abs(
          (proposal.newPrice - proposal.existingPrice) / proposal.existingPrice
        );
        if (pctDiff > 0.01) {
          batch.update(productRef, {
            costPrice: proposal.newPrice,
            costPriceUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
            lastInvoicePrice: proposal.newPrice,
            lastInvoicePriceAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            ...caseSizeFields,
          });
          ops++;
          changed++;
        } else {
          // Same price — touch to record that the user confirmed this match
          batch.update(productRef, {
            lastInvoicePrice: proposal.newPrice,
            lastInvoicePriceAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            ...caseSizeFields,
          });
          ops++;
        }
      } else {
        // First-time price set on confirmed near-duplicate
        batch.update(productRef, {
          costPrice: proposal.newPrice,
          costPriceUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
          lastInvoicePrice: proposal.newPrice,
          lastInvoicePriceAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          ...caseSizeFields,
        });
        ops++;
      }
      // Now has a real product ID — queue for area-item linking
      newlyResolvedMap[proposal.lineName] = proposal.candidateProductId;

    } else if (proposal.type === "newProduct") {
      const newRef = db.collection(`venues/${venueId}/products`).doc();
      const cs = proposal.caseSize;
      const caseSizeFields = cs
        ? {
            caseSize: cs,
            ...(proposal.unitPrice != null
              ? { unitCost: proposal.unitPrice / cs, caseCost: proposal.unitPrice }
              : {}),
          }
        : {};
      batch.set(newRef, {
        name: proposal.lineName,
        costPrice: proposal.unitPrice,
        costPriceUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
        costPriceSource: "invoice",
        lastInvoicePrice: proposal.unitPrice,
        lastInvoicePriceAt: admin.firestore.FieldValue.serverTimestamp(),
        supplierId: cleanSupplierId,
        supplierName: cleanSupplierName,
        inductionSource: "invoice-price-tracking",
        inductionStatus: "pending",
        priceChanged: false,
        ...caseSizeFields,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      ops++;
      created++;
      newlyResolvedMap[proposal.lineName] = newRef.id;
      console.log(`[commitInvoiceChanges] new product queued: "${proposal.lineName}"`);
    }
    // supplierLink proposals handled after the batch (need per-doc reads)
  }

  if (ops > 0) {
    await batch.commit();
    console.log("[commitInvoiceChanges] committed", { venueId, ops, changed, created, invoiceId });
  }

  // Area-item linking for lines that got a real product ID for the first time
  await applyAreaItemLinking(db, venueId, newlyResolvedMap, "commitInvoiceChanges");

  // Supplier link proposals — individual reads, outside batch
  const supplierLinkProposals = accepted.filter(
    (p): p is ProposedAction & { type: "supplierLink" } => p.type === "supplierLink"
  );
  for (const proposal of supplierLinkProposals) {
    const supplierRef = db.doc(
      `venues/${venueId}/products/${proposal.productId}/suppliers/${proposal.supplierId}`
    );
    try {
      const snap = await supplierRef.get();
      const invoicePrice = proposal.caseSize
        ? proposal.unitCost * proposal.caseSize
        : proposal.unitCost;

      if (!snap.exists) {
        // Fresh product read for primarySupplierId (state may have changed since propose)
        const productSnap = await db
          .doc(`venues/${venueId}/products/${proposal.productId}`)
          .get();
        const hasPreferred = !!((productSnap.data() as any)?.primarySupplierId);
        await supplierRef.set({
          supplierId: proposal.supplierId,
          supplierName: proposal.supplierName,
          unitCost: proposal.unitCost,
          caseSize: proposal.caseSize,
          caseCost: proposal.caseSize ? invoicePrice : null,
          isPreferred: !hasPreferred,
          relationship: "alternative",
          agreedPrice: proposal.unitCost,
          agreedPriceSetAt: admin.firestore.FieldValue.serverTimestamp(),
          agreedPriceSource: "invoice",
          lastInvoiceAt: admin.firestore.FieldValue.serverTimestamp(),
          lastInvoicePrice: invoicePrice,
          addedAt: admin.firestore.FieldValue.serverTimestamp(),
          addedBy: "invoice-import",
        });
        if (!hasPreferred) {
          await db.doc(`venues/${venueId}/products/${proposal.productId}`).update({
            primarySupplierId: proposal.supplierId,
            primarySupplierName: proposal.supplierName,
          });
        }
      } else {
        await supplierRef.update({
          unitCost: proposal.unitCost,
          caseSize: proposal.caseSize,
          lastInvoiceAt: admin.firestore.FieldValue.serverTimestamp(),
          lastInvoicePrice: invoicePrice,
        });
      }
    } catch (e: any) {
      console.log("[commitInvoiceChanges] supplier link error", proposal.productId, e?.message);
    }
  }

  return { changed, created, productMap: newlyResolvedMap };
}
