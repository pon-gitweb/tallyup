import * as FileSystem from 'expo-file-system/legacy';
import { NormalizedSalesReport } from './types';
import { parseCsvText, parseSalesExport } from './parseSalesExport';

// Derive the Cloud Functions base from EXPO_PUBLIC_AI_URL.
function aiBase() {
  if (
    typeof process !== 'undefined' &&
    (process as any).env?.EXPO_PUBLIC_AI_URL
  ) {
    return String((process as any).env.EXPO_PUBLIC_AI_URL);
  }
  return 'https://us-central1-tallyup-f1463.cloudfunctions.net/api';
}

function functionsBase() {
  return aiBase().replace(/\/api\/?$/, '');
}

function toNormalized(text: string): NormalizedSalesReport {
  const rows = parseCsvText(text);
  const parsed = parseSalesExport(rows);

  if (!parsed.lines.length && !rows.length) {
    return { source: 'csv', period: {}, lines: [], warnings: ['empty csv'] };
  }

  // Extract period from first data row when format is hosti_flat
  // (hosti_flat may carry date_start / date_end columns)
  let periodStart: string | null = null;
  let periodEnd: string | null = null;
  if (parsed.format === 'hosti_flat' && rows.length > 1) {
    const header = rows[parsed.headerRowIndex].map(h => h.trim().toLowerCase());
    const iStart = header.indexOf('date_start');
    const iEnd   = header.indexOf('date_end');
    const firstRow = rows[parsed.headerRowIndex + 1] ?? [];
    if (iStart >= 0) periodStart = firstRow[iStart] || null;
    if (iEnd   >= 0) periodEnd   = firstRow[iEnd]   || null;
  }

  return {
    source: 'csv',
    period: { start: periodStart, end: periodEnd },
    lines: parsed.lines.map(l => ({
      sku:      null,
      barcode:  null,
      name:     l.name,
      qtySold:  l.qtySold,
      gross:    l.gross,
      net:      l.net,
      tax:      null,
      unitPrice: l.unitPrice ?? null,
      category:  l.category ?? null,
      derived:   l.derived,
    })),
    warnings: parsed.warnings,
    sourceFormat:      parsed.sourceFormat,
    parserVersion:     parsed.parserVersion,
    lineTotalsBasis:   parsed.lineTotalsBasis,
    gstBasis:          parsed.gstBasis,
  };
}

export async function processSalesCsv(args: {
  venueId: string;
  fileUri: string;
  filename: string;
}) {
  const text = await FileSystem.readAsStringAsync(args.fileUri, {
    encoding: FileSystem.EncodingType.UTF8,
  });
  return toNormalized(text);
}

export async function processSalesPdf(args: {
  venueId: string;
  fileUri: string;
  filename: string;
}) {
  const { venueId, fileUri, filename } = args;

  if (!venueId) throw new Error('processSalesPdf: venueId required');
  if (!fileUri || !fileUri.startsWith('file')) {
    throw new Error('processSalesPdf: expected a local file URI');
  }

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
      throw new Error(
        'Sales PDF import is not enabled on this project yet. Export a CSV from your POS and upload that instead.'
      );
    }
    const msg = (json && (json.error || json.message)) || `HTTP ${res.status}`;
    throw new Error(`process-sales-pdf failed: ${msg}`);
  }

  return json.report || json;
}
