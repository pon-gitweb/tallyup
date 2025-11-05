import { classifyLine, lineTotal, sum } from './classify';
import type { ParsedInvoiceLine, OrderLine, ReconcileOptions, ReconcileBuckets } from './types';

function normName(s?: string) {
  return (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function reconcileInvoice(
  parsedLines: ParsedInvoiceLine[],
  orderLines: OrderLine[],
  opts: ReconcileOptions = { priceTolerancePct: 0.02 }
): ReconcileBuckets {
  const tol = Math.max(0, Math.min(1, opts.priceTolerancePct ?? 0.02));

  // Classify and split product vs charges
  const withType = parsedLines.map(l => ({ ...l, lineType: l.lineType || classifyLine(l) }));
  const productLines = withType.filter(l => l.lineType === 'product');
  const chargesLines = withType.filter(l => l.lineType !== 'product');

  // Build easy lookups for order lines
  const orderByCode = new Map<string, OrderLine>();
  const orderByName = new Map<string, OrderLine>();
  for (const ol of orderLines) {
    const code = (ol as any).code || (ol as any).sku; // if you later attach codes to order lines
    if (code) orderByCode.set(String(code).toLowerCase(), ol);
    const key = normName(ol.name || ol.productId || ol.id);
    orderByName.set(key, ol);
  }

  const matchedOk: ReconcileBuckets['matchedOk'] = [];
  const qtyVariance: ReconcileBuckets['qtyVariance'] = [];
  const priceVariance: ReconcileBuckets['priceVariance'] = [];
  const unknownItems: ParsedInvoiceLine[] = [];

  for (const pl of productLines) {
    const codeKey = pl.code ? pl.code.toLowerCase() : '';
    let ol: OrderLine | undefined = codeKey ? orderByCode.get(codeKey) : undefined;
    if (!ol) {
      ol = orderByName.get(normName(pl.name));
    }
    if (!ol) {
      unknownItems.push(pl);
      continue;
    }
    const orderQty = Number(ol.qty ?? 0);
    const orderUnit = Number(ol.unitCost ?? 0);
    const invQty = Number(pl.qty ?? 0);
    const invUnit = Number(pl.unitPrice ?? 0);

    const priceDeltaPct = orderUnit > 0 ? Math.abs(invUnit - orderUnit) / orderUnit : (invUnit > 0 ? 1 : 0);

    if (orderQty === invQty && priceDeltaPct <= tol) {
      matchedOk.push({
        name: pl.name,
        orderQty,
        orderUnitCost: orderUnit,
        invoiceQty: invQty,
        invoiceUnitPrice: invUnit,
      });
      continue;
    }

    if (orderQty !== invQty) {
      qtyVariance.push({
        name: pl.name,
        orderQty,
        invoiceQty: invQty,
        orderUnitCost: orderUnit,
      });
    }
    if (priceDeltaPct > tol) {
      priceVariance.push({
        name: pl.name,
        orderUnitCost: orderUnit,
        invoiceUnitPrice: invUnit,
        qty: invQty,
        deltaPct: priceDeltaPct,
      });
    }
  }

  // Missing items: in order but not on invoice
  const productNamesSeen = new Set(productLines.map(p => normName(p.name)));
  const missingItems: ReconcileBuckets['missingItems'] = [];
  for (const ol of orderLines) {
    const key = normName(ol.name || ol.productId || ol.id);
    if (!productNamesSeen.has(key)) {
      missingItems.push({
        name: ol.name || String(ol.productId || ol.id),
        orderQty: Number(ol.qty ?? 0),
        orderUnitCost: Number(ol.unitCost ?? 0),
      });
    }
  }

  const itemsSubTotal = sum(productLines.map(lineTotal));

  const charges = {
    freight: chargesLines.filter(l => l.lineType === 'freight'),
    surcharge: chargesLines.filter(l => l.lineType === 'surcharge'),
    ullage: chargesLines.filter(l => l.lineType === 'ullage'),
    deposit_returnable: chargesLines.filter(l => l.lineType === 'deposit_returnable'),
    discount: chargesLines.filter(l => l.lineType === 'discount'),
    tax: chargesLines.filter(l => l.lineType === 'tax'),
    other: chargesLines.filter(l => l.lineType === 'other'),
    total: sum(chargesLines.map(lineTotal)),
  };

  const totals = {
    itemsSubTotal,
    chargesTotal: charges.total,
    grandTotal: itemsSubTotal + charges.total,
  };

  const flags = {
    hasDeposits: charges.deposit_returnable.length > 0,
    hasUllage: charges.ullage.length > 0,
    hasFreight: charges.freight.length > 0,
  };

  return {
    matchedOk,
    qtyVariance,
    priceVariance,
    unknownItems,
    missingItems,
    charges,
    totals,
    flags,
  };
}
