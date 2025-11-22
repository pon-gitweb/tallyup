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
exports.ocrInvoicePhoto = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const vision_1 = require("@google-cloud/vision");
const vision = new vision_1.ImageAnnotatorClient();
// Extract a PO / invoice-ish identifier from free text
function extractPo(text) {
    const patterns = [
        /PO\s*#\s*([A-Z0-9\-]{3,})/i,
        /P\.?O\.?\s*[:#]?\s*([A-Z0-9\-]{3,})/i,
        /\bPO\s*([A-Z0-9\-]{3,})\b/i,
    ];
    for (const rx of patterns) {
        const m = text.match(rx);
        if (m === null || m === void 0 ? void 0 : m[1])
            return m[1].toUpperCase().slice(0, 64);
    }
    return null;
}
// Very simple line extraction: "NAME ... 3 12.34"
function extractLines(text) {
    const out = [];
    const lines = text
        .split(/\r?\n/)
        .map(s => s.trim())
        .filter(Boolean);
    for (const raw of lines) {
        const qtyMatch = raw.match(/\b(\d{1,4})\s*(?:x|@)?\b/i);
        const priceMatch = raw.match(/\$?\s*(\d{1,5}(?:\.\d{1,2})?)\s*$/);
        const qty = qtyMatch ? Number(qtyMatch[1]) : NaN;
        const price = priceMatch ? Number(priceMatch[1]) : NaN;
        if (!Number.isNaN(qty) && qty > 0 && !Number.isNaN(price) && price > 0) {
            const name = raw.replace(/\$?\s*\d{1,5}(?:\.\d{1,2})?\s*$/, "").trim();
            if (name.length >= 3)
                out.push({ name, qty, unitPrice: price });
        }
        if (out.length >= 80)
            break; // hard cap to keep payload small
    }
    // Fallback: just take first few non-empty lines as qty=1 items
    if (out.length === 0) {
        for (const raw of lines.slice(0, 20)) {
            if (raw.length >= 3)
                out.push({ name: raw, qty: 1 });
        }
    }
    return out;
}
// Dedicated photo-invoice OCR callable.
// Input: { venueId, imageBase64 }
// Output: { lines, supplierName?, invoiceNumber?, deliveryDate?, rawText }
exports.ocrInvoicePhoto = functions
    .region("us-central1")
    .https.onCall(async (data, context) => {
    var _a, _b, _c;
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "Sign in required.");
    }
    const uid = String(context.auth.uid || "");
    const venueId = String((data === null || data === void 0 ? void 0 : data.venueId) || "");
    const imageBase64 = String((data === null || data === void 0 ? void 0 : data.imageBase64) || "");
    if (!venueId) {
        throw new functions.https.HttpsError("invalid-argument", "venueId is required.");
    }
    if (!imageBase64) {
        throw new functions.https.HttpsError("invalid-argument", "imageBase64 is required.");
    }
    // Optional: security check – user must be a member of the venue
    const db = admin.firestore();
    const memberRef = db.doc(`venues/${venueId}/members/${uid}`);
    const memberSnap = await memberRef.get();
    if (!memberSnap.exists) {
        throw new functions.https.HttpsError("permission-denied", "Not a member of this venue.");
    }
    let buf;
    try {
        buf = Buffer.from(imageBase64, "base64");
    }
    catch (e) {
        console.error("[ocrInvoicePhoto] invalid base64", (e === null || e === void 0 ? void 0 : e.message) || e);
        throw new functions.https.HttpsError("invalid-argument", "Invalid imageBase64.");
    }
    const [result] = await vision.textDetection({ image: { content: buf } });
    const text = ((_a = result === null || result === void 0 ? void 0 : result.fullTextAnnotation) === null || _a === void 0 ? void 0 : _a.text) ||
        ((_c = (_b = result === null || result === void 0 ? void 0 : result.textAnnotations) === null || _b === void 0 ? void 0 : _b[0]) === null || _c === void 0 ? void 0 : _c.description) ||
        "";
    if (!text.trim()) {
        console.log("[ocrInvoicePhoto] OCR returned no text");
        return {
            supplierName: null,
            invoiceNumber: null,
            deliveryDate: null,
            lines: [],
            rawText: "",
        };
    }
    const invoiceNumber = extractPo(text);
    const lines = extractLines(text);
    const payload = {
        supplierName: null,
        invoiceNumber: invoiceNumber,
        deliveryDate: null,
        lines,
        rawText: text,
    };
    console.log("[ocrInvoicePhoto] payload", {
        invoiceNumber: payload.invoiceNumber,
        linesCount: payload.lines.length,
    });
    // onCall will wrap this as { result: payload } for HTTPS; our RN client
    // supports both {result: ...} and plain object.
    return payload;
});
//# sourceMappingURL=ocrInvoicePhoto.js.map