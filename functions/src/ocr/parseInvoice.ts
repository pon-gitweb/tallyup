import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
const vision = require('@google-cloud/vision');

const db = admin.firestore();
const client = new vision.ImageAnnotatorClient();

export const onOcrJobQueued = functions.firestore
  .document('venues/{venueId}/ocrJobs/{jobId}')
  .onUpdate(async (change, context) => {
    const before = change.before.data() as any;
    const after = change.after.data() as any;
    const { venueId, jobId } = context.params;

    // Only act when status flips to queued
    if (before?.status === after?.status || after?.status !== 'queued') return;

    try {
      const file = after?.file;
      if (!file?.gsUrl) throw new Error('Missing gsUrl');

      // 1) Run OCR
      const [result] = await client.documentTextDetection(file.gsUrl);
      const text = result?.fullTextAnnotation?.text || '';

      // 2) Naive parse (MVP): split lines and try to infer qty/price
      // You can improve this parser later; it returns a stable normalized shape now.
      const lines: Array<{ name: string; qty: number; unit?: string; unitPrice?: number }> = [];
      const candidates = text.split('\n').map((s: string) => s.trim()).filter(Boolean);

      for (const s of candidates) {
        // a couple of simple patterns: "Lime 6 x 1kg  $12.50" or "Lime    6    12.50"
        const m1 = s.match(/^(.+?)\s+(\d+(?:\.\d+)?)\s*x?\s*(\S+)?\s+\$?(\d+(?:\.\d+)?)/i);
        const m2 = s.match(/^(.+?)\s+(\d+(?:\.\d+)?)(?:\s+@)?\s+\$?(\d+(?:\.\d+)?)/i);
        if (m1) {
          lines.push({ name: m1[1], qty: Number(m1[2]), unit: m1[3] || undefined, unitPrice: Number(m1[4]) });
        } else if (m2) {
          lines.push({ name: m2[1], qty: Number(m2[2]), unitPrice: Number(m2[3]) });
        }
      }

      const normalized = {
        supplierName: undefined,
        invoiceNumber: undefined,
        deliveryDate: undefined,
        lines
      };

      await change.after.ref.update({
        status: 'done',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        result: normalized,
        rawText: text
      });
    } catch (e:any) {
      await change.after.ref.update({
        status: 'error',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        errorMessage: e?.message || String(e)
      });
    }
  });
