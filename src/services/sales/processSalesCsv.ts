// @ts-nocheck
import * as FileSystem from 'expo-file-system';
import { NormalizedSalesReport, NormalizedSalesLine } from './types';

// Minimal REST shim
const BASE = (typeof process !== 'undefined' && (process as any).env?.EXPO_PUBLIC_AI_URL)
  ? String((process as any).env.EXPO_PUBLIC_AI_URL).replace(/\/+$/,'')
  : '';

async function postJson(url:string, body:any) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type':'application/json' },
    body: JSON.stringify(body),
  });
  return res;
}

// Simple CSV parser that handles quoted cells and commas
function parseCsv(text:string): string[][] {
  const rows:string[][] = [];
  let i=0, cur:string[] = [], cell='', inQuotes=false;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i+1] === '"') { cell += '"'; i++; } else { inQuotes = false; }
      } else {
        cell += ch;
      }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { cur.push(cell); cell=''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i+1] === '\n') i++;
        cur.push(cell); cell='';
        if (cur.length>1 || (cur.length===1 && cur[0]!=='')) rows.push(cur);
        cur = [];
      } else { cell += ch; }
    }
    i++;
  }
  if (cell.length || cur.length) { cur.push(cell); rows.push(cur); }
  return rows;
}

function toNormalized(lines: string[][]): NormalizedSalesReport {
  if (!lines.length) return { source:'csv', period:{}, lines:[], warnings:['empty csv'] };

  const header = lines[0].map(h => h.trim().toLowerCase());
  const idx = (k:string) => header.indexOf(k);

  const iStart = idx('date_start');
  const iEnd   = idx('date_end');
  const iSku   = idx('sku');
  const iBar   = idx('barcode');
  const iName  = idx('name');
  const iQty   = idx('qty_sold');
  const iGross = idx('gross');
  const iNet   = idx('net');
  const iTax   = idx('tax');

  const out: NormalizedSalesLine[] = [];
  for (let r=1; r<lines.length; r++) {
    const row = lines[r];
    const get = (i:number) => (i>=0 && i<row.length ? row[i] : '').trim();
    const qty = Number(get(iQty) || 0);
    out.push({
      sku: iSku>=0 ? get(iSku) || null : null,
      barcode: iBar>=0 ? get(iBar) || null : null,
      name: iName>=0 ? get(iName) || '' : '',
      qtySold: Number.isFinite(qty) ? qty : 0,
      gross: iGross>=0 ? (Number(get(iGross)) || null) : null,
      net: iNet>=0 ? (Number(get(iNet)) || null) : null,
      tax: iTax>=0 ? (Number(get(iTax)) || null) : null,
    });
  }

  const report: NormalizedSalesReport = {
    source: 'csv',
    period: {
      start: iStart>=0 ? lines[1]?.[iStart] || null : null,
      end:   iEnd>=0 ? lines[1]?.[iEnd]   || null : null,
    },
    lines: out,
    warnings: [],
  };
  return report;
}

export async function processSalesCsv(args: { venueId:string; fileUri:string; filename:string }) {
  // 1) Try server first if configured
  if (BASE) {
    try {
      const primary = `${BASE}/process-sales-csv`;
      const fallback = `${BASE}/api/process-sales-csv`;
      let res = await postJson(primary, args);
      if (res.status === 404) res = await postJson(fallback, args);
      const json = await res.json().catch(()=>null);
      if (res.ok && json && json.ok !== false) {
        return json;
      }
      // fall through to local parse
    } catch (_) {
      // fall through to local parse
    }
  }

  // 2) Local fallback: read CSV, parse, normalize
  const text = await FileSystem.readAsStringAsync(args.fileUri, { encoding: FileSystem.EncodingType.UTF8 });
  const matrix = parseCsv(text);
  return toNormalized(matrix);
}
