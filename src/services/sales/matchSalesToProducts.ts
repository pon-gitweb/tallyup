// @ts-nocheck
import { getApp } from 'firebase/app';
import {
  getFirestore, collection, getDocs, query, where, addDoc, serverTimestamp
} from 'firebase/firestore';
import { NormalizedSalesReport, NormalizedSalesLine } from './types';

/**
 * Load a lightweight product index for matching.
 * Expected product fields (as per Truth Doc modeling):
 * - barcode?: string
 * - altBarcodes?: string[]
 * - sku?: string
 * - altCodes?: string[]
 * - name: string
 */
async function buildProductIndex(db:any, venueId:string) {
  const snap = await getDocs(collection(db, 'venues', venueId, 'products'));
  const byBarcode = new Map<string,string>(); // barcode -> productId
  const bySku = new Map<string,string>();     // sku/alt -> productId
  const byName = new Map<string,string>();    // lower(name) -> productId

  snap.forEach(d => {
    const p:any = d.data() || {};
    const id = d.id;

    const bar = (p.barcode || '').trim();
    if (bar) byBarcode.set(bar, id);
    if (Array.isArray(p.altBarcodes)) {
      p.altBarcodes.forEach((b:string) => { const v=(b||'').trim(); if (v) byBarcode.set(v, id); });
    }

    const sku = (p.sku || '').trim();
    if (sku) bySku.set(sku, id);
    if (Array.isArray(p.altCodes)) {
      p.altCodes.forEach((s:string) => { const v=(s||'').trim(); if (v) bySku.set(v, id); });
    }

    const nm = (p.name || '').trim().toLowerCase();
    if (nm) byName.set(nm, id);
  });

  return { byBarcode, bySku, byName };
}

function matchOne(index:any, line: NormalizedSalesLine) {
  const bc = (line.barcode || '').trim();
  if (bc && index.byBarcode.has(bc)) {
    return { productId: index.byBarcode.get(bc), via: 'barcode' };
  }
  const sku = (line.sku || '').trim();
  if (sku && index.bySku.has(sku)) {
    return { productId: index.bySku.get(sku), via: 'sku' };
  }
  const nm = (line.name || '').trim().toLowerCase();
  if (nm && index.byName.has(nm)) {
    return { productId: index.byName.get(nm), via: 'name' };
  }
  return null;
}

/**
 * Persist unknown lines for later mapping by a manager.
 * Path: venues/{v}/salesReportUnknowns/{autoId}
 */
async function writeUnknown(db:any, venueId:string, reportId:string, line: NormalizedSalesLine) {
  await addDoc(collection(db, 'venues', venueId, 'salesReportUnknowns'), {
    reportId,
    line,
    createdAt: serverTimestamp(),
    status: 'unmapped',
  });
}

export async function matchSalesToProducts(args: {
  venueId: string;
  reportId: string; // the Firestore id of the stored raw report
  report: NormalizedSalesReport;
}) {
  const { venueId, reportId, report } = args;
  const db = getFirestore(getApp());

  const index = await buildProductIndex(db, venueId);

  const matches: Array<{ productId:string; qtySold:number; gross:number|null; net:number|null; via:string }> = [];
  let unknowns = 0;

  for (const line of (report.lines || [])) {
    const m = matchOne(index, line);
    if (m?.productId) {
      matches.push({
        productId: m.productId,
        qtySold: Number(line.qtySold || 0),
        gross: line.gross ?? null,
        net: line.net ?? null,
        via: m.via,
      });
    } else {
      unknowns++;
      await writeUnknown(db, venueId, reportId, line);
    }
  }

  // Write a match summary for analytics
  await addDoc(collection(db, 'venues', venueId, 'salesReportMatches'), {
    reportId,
    counts: { total: report.lines?.length || 0, matched: matches.length, unknowns },
    matches,
    period: report.period || null,
    createdAt: serverTimestamp(),
  });

  return { matched: matches.length, unknowns };
}
