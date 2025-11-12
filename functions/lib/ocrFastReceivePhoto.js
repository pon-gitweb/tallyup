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
exports.ocrFastReceivePhoto = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const vision_1 = require("@google-cloud/vision");
const vision = new vision_1.ImageAnnotatorClient();
function extractPo(text) {
    const patterns = [
        /PO\s*#\s*([A-Z0-9\-]{3,})/i,
        /P\.?O\.?\s*[:#]?\s*([A-Z0-9\-]{3,})/i,
        /\bPO\s*([A-Z0-9\-]{3,})\b/i,
    ];
    for (const rx of patterns) {
        const m = text.match(rx);
        if (m?.[1])
            return m[1].toUpperCase().slice(0, 64);
    }
    return null;
}
function extractLines(text) {
    const out = [];
    const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
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
        if (out.length >= 40)
            break;
    }
    if (out.length === 0) {
        for (const raw of lines.slice(0, 15)) {
            if (raw.length >= 3)
                out.push({ name: raw, qty: 1 });
        }
    }
    return out;
}
// IMPORTANT: region pinned to us-central1 to match the app caller
exports.ocrFastReceivePhoto = functions
    .region("us-central1")
    .https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "Sign in required.");
    }
    const uid = String(context.auth.uid || "");
    const venueId = String(data?.venueId || "");
    const fastId = data?.fastId ? String(data.fastId) : "";
    const storagePathArg = data?.storagePath ? String(data.storagePath) : "";
    if (!venueId) {
        throw new functions.https.HttpsError("invalid-argument", "venueId is required.");
    }
    const db = admin.firestore();
    const memberRef = db.doc(`venues/${venueId}/members/${uid}`);
    const memberSnap = await memberRef.get();
    if (!memberSnap.exists) {
        throw new functions.https.HttpsError("permission-denied", "Not a member of this venue.");
    }
    // Load snapshot by ID, else fallback to storagePath
    let fastRef = fastId ? db.doc(`venues/${venueId}/fastReceives/${fastId}`) : null;
    let fastSnap = fastRef ? await fastRef.get() : null;
    if (!fastSnap?.exists) {
        if (!storagePathArg) {
            throw new functions.https.HttpsError("not-found", "Snapshot not found and no storagePath provided.");
        }
        const q = await db.collection(`venues/${venueId}/fastReceives`)
            .where("storagePath", "==", storagePathArg)
            .limit(1)
            .get();
        if (q.empty) {
            throw new functions.https.HttpsError("not-found", "Snapshot not found by storagePath.");
        }
        fastSnap = q.docs[0];
        fastRef = fastSnap.ref;
    }
    const fast = fastSnap.data() || {};
    const storagePath = String(fast.storagePath ||
        fast?.payload?.invoice?.storagePath ||
        storagePathArg ||
        "");
    if (!storagePath) {
        throw new functions.https.HttpsError("failed-precondition", "No storagePath on snapshot.");
    }
    const bucket = admin.storage().bucket();
    console.log("[ocrFastReceivePhoto] bucket=", bucket.name, "storagePath=", storagePath);
    let buf;
    try {
        [buf] = await bucket.file(storagePath).download();
    }
    catch (e) {
        console.error("[ocrFastReceivePhoto] download failed", { storagePath }, e?.message || e);
        throw new functions.https.HttpsError("internal", "download failed: " + (e?.message || e));
    }
    const [result] = await vision.textDetection({ image: { content: buf } });
    const text = result?.fullTextAnnotation?.text ||
        result?.textAnnotations?.[0]?.description ||
        "";
    if (!text.trim()) {
        await fastRef.set({
            payload: {
                ...(fast.payload || {}),
                warnings: [...(fast.payload?.warnings || []), "OCR returned no text."]
            }
        }, { merge: true });
        return { ok: true, parsedPo: null, linesCount: 0, info: "no-text" };
    }
    const parsedPo = extractPo(text);
    const lines = extractLines(text);
    const confidence = 0.5;
    await fastRef.set({
        parsedPo: parsedPo ?? null,
        payload: {
            ...(fast.payload || {}),
            invoice: {
                ...(fast.payload?.invoice || {}),
                source: "photo",
                storagePath,
            },
            lines,
            confidence,
            warnings: [...(fast.payload?.warnings || []), "OCR processed (beta heuristics)."]
        }
    }, { merge: true });
    return { ok: true, parsedPo, linesCount: lines.length };
});
