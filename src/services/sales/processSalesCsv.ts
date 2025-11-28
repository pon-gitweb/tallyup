// @ts-nocheck
import * as FileSystem from 'expo-file-system';
import { NormalizedSalesReport, NormalizedSalesLine } from './types';

// Derive the Cloud Functions base from EXPO_PUBLIC_AI_URL.
// If EXPO_PUBLIC_AI_URL is "https://.../api", this becomes "https://..."
function aiBase() {
  if (
    typeof process !== 'undefined' &&
    (process as any).env?.EXPO_PUBLIC_AI_URL
  ) {
    return String((process as any).env.EXPO_PUBLIC_AI_URL);
  }
  // Fallback: your current default
  return 'https://us-central1-tallyup-f1463.cloudfunctions.net/api';
}

function functionsBase() {
  return aiBase().replace(/\/api\/?$/, '');
}

// Simple CSV parser that handles quoted cells and commas
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let i = 0;
  let cur: string[] = [];
  let cell = '';
  let inQuotes = false;

  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        cur.push(cell);
        cell = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        cur.push(cell);
        cell = '';
        if (cur.length > 1 || (cur.length === 1 && cur[0] !== '')) {
          rows.push(cur);
        }
        cur = [];
      } else {
        cell += ch;
      }
    }
    i++;
  }
  if (cell.length || cur.length) {
    cur.push(cell);
    rows.push(cur);
  }
  return rows;
}

function toNormalized(lines: string[][]): NormalizedSalesReport {
  if (!lines.length) {
    return {
      source: 'csv',
      period: {},
      lines: [],
      warnings: ['empty csv'],
    };
  }

  const header = lines[0].map((h) => h.trim().toLowerCase());
  const idx = (k: string) => header.indexOf(k);

  const iStart = idx('date_start');
  const iEnd = idx('date_end');
  const iSku = idx('sku');
  const iBar = idx('barcode');
  const iName = idx('name');
  const iQty = idx('qty_sold');
  const iGross = idx('gross');
  const iNet = idx('net');
  const iTax = idx('tax');

  const out: NormalizedSalesLine[] = [];
  for (let r = 1; r < lines.length; r++) {
    const row = lines[r];
    const get = (i: number) =>
      i >= 0 && i < row.length ? row[i] : '';
    const qty = Number(get(iQty) || 0);
    out.push({
      sku: iSku >= 0 ? (get(iSku) || null) : null,
      barcode: iBar >= 0 ? (get(iBar) || null) : null,
      name: iName >= 0 ? get(iName) || '' : '',
      qtySold: Number.isFinite(qty) ? qty : 0,
      gross: iGross >= 0 ? Number(get(iGross)) || null : null,
      net: iNet >= 0 ? Number(get(iNet)) || null : null,
      tax: iTax >= 0 ? Number(get(iTax)) || null : null,
    });
  }

  const report: NormalizedSalesReport = {
    source: 'csv',
    period: {
      start: iStart >= 0 ? lines[1]?.[iStart] || null : null,
      end: iEnd >= 0 ? lines[1]?.[iEnd] || null : null,
    },
    lines: out,
    warnings: [],
  };

  return report;
}

export async function processSalesCsv(args: {
  venueId: string;
  fileUri: string;
  filename: string;
}) {
  // Pure local parse: read CSV, normalize
  const text = await FileSystem.readAsStringAsync(args.fileUri, {
    encoding: FileSystem.EncodingType.UTF8,
  });
  const matrix = parseCsv(text);
  return toNormalized(matrix);
}

export async function processSalesPdf(args: {
  venueId: string;
  fileUri: string;
  filename: string;
}) {
  const { venueId, fileUri, filename } = args;

  if (!venueId) {
    throw new Error('processSalesPdf: venueId required');
  }
  if (!fileUri || !fileUri.startsWith('file')) {
    throw new Error('processSalesPdf: expected a local file URI');
  }

  // Read the PDF as base64 and send to the Cloud Function
  const base64 = await FileSystem.readAsStringAsync(fileUri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  const url = functionsBase() + '/processSalesPdf';

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      venueId,
      filename: filename || 'sales.pdf',
      data: `data:application/pdf;base64,${base64}`,
    }),
  });

  const json = await res.json().catch(() => null);

  if (!res.ok || !json || json.ok === false) {
    if (res.status === 404) {
      // Clean message for the case where the function hasn't been deployed yet
      throw new Error(
        'Sales PDF import is not enabled on this project yet. Export a CSV from your POS and upload that instead.'
      );
    }
    const msg = (json && (json.error || json.message)) || `HTTP ${res.status}`;
    throw new Error(`process-sales-pdf failed: ${msg}`);
  }

  // CF returns { ok:true, report } – but tolerate direct NormalizedSalesReport as well
  return json.report || json;
}
