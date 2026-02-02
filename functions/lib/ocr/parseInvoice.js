"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.onOcrJobQueued = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const vision = require('@google-cloud/vision');
const db = admin.firestore();
const client = new vision.ImageAnnotatorClient();
exports.onOcrJobQueued = functions.firestore
    .document('venues/{venueId}/ocrJobs/{jobId}')
    .onUpdate(async (change, context) => {
    const before = change.before.data();
    const after = change.after.data();
    const { venueId, jobId } = context.params;
    // Only act when status flips to queued
    if (before?.status === after?.status || after?.status !== 'queued')
        return;
    try {
        const file = after?.file;
        if (!file?.gsUrl)
            throw new Error('Missing gsUrl');
        // 1) Run OCR
        const [result] = await client.documentTextDetection(file.gsUrl);
        const text = result?.fullTextAnnotation?.text || '';
        // 2) Naive parse (MVP): split lines and try to infer qty/price
        // You can improve this parser later; it returns a stable normalized shape now.
        const lines = [];
        const candidates = text.split('\n').map((s) => s.trim()).filter(Boolean);
        for (const s of candidates) {
            // a couple of simple patterns: "Lime 6 x 1kg  $12.50" or "Lime    6    12.50"
            const m1 = s.match(/^(.+?)\s+(\d+(?:\.\d+)?)\s*x?\s*(\S+)?\s+\$?(\d+(?:\.\d+)?)/i);
            const m2 = s.match(/^(.+?)\s+(\d+(?:\.\d+)?)(?:\s+@)?\s+\$?(\d+(?:\.\d+)?)/i);
            if (m1) {
                lines.push({ name: m1[1], qty: Number(m1[2]), unit: m1[3] || undefined, unitPrice: Number(m1[4]) });
            }
            else if (m2) {
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
    }
    catch (e) {
        await change.after.ref.update({
            status: 'error',
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            errorMessage: e?.message || String(e)
        });
    }
});
//# sourceMappingURL=parseInvoice.js.map