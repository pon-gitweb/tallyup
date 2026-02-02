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
exports.onShelfScanJobCreate = void 0;
// @ts-nocheck
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const processShelfScanJob_1 = require("./processShelfScanJob");
const crypto_1 = require("crypto");
if (!admin.apps.length)
    admin.initializeApp();
const BUCKET_NAME = process.env.FIREBASE_STORAGE_BUCKET ||
    process.env.STORAGE_BUCKET ||
    admin.app().options?.storageBucket ||
    "tallyup-f1463.firebasestorage.app";
function buildDownloadUrl(bucket, fullPath, token) {
    return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(fullPath)}?alt=media&token=${token}`;
}
async function ensureDownloadUrl(fullPath) {
    const bucket = admin.storage().bucket(BUCKET_NAME);
    const file = bucket.file(fullPath);
    const [exists] = await file.exists();
    if (!exists) {
        return { ok: false, reason: "file-not-found", bucket: bucket.name, fullPath };
    }
    let [meta] = await file.getMetadata();
    let token = meta?.metadata?.firebaseStorageDownloadTokens ||
        meta?.metadata?.firebaseStorageDownloadToken ||
        "";
    if (typeof token === "string" && token.includes(","))
        token = token.split(",")[0].trim();
    if (!token) {
        token = (0, crypto_1.randomUUID)();
        await file.setMetadata({ metadata: { firebaseStorageDownloadTokens: token } });
        [meta] = await file.getMetadata();
    }
    const bytes = Number(meta?.size || 0);
    const contentType = String(meta?.contentType || "application/octet-stream");
    const downloadUrl = buildDownloadUrl(bucket.name, fullPath, token);
    return {
        ok: true,
        bucket: bucket.name,
        fullPath,
        downloadUrl,
        bytes,
        contentType,
    };
}
exports.onShelfScanJobCreate = functions
    .region("us-central1")
    .firestore.document("venues/{venueId}/shelfScanJobs/{jobId}")
    .onCreate(async (snap, ctx) => {
    const { venueId, jobId } = ctx.params;
    const ref = snap.ref;
    const data = snap.data() || {};
    console.log("[ShelfScan] start", { venueId, jobId, keys: Object.keys(data || {}) });
    await ref.set({
        status: "processing",
        debug: { createdKeys: Object.keys(data || {}) },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    try {
        await (0, processShelfScanJob_1.processShelfScanJob)({ venueId, jobId });
        const freshSnap = await ref.get();
        const fresh = freshSnap.data() || {};
        const photoPath = String(fresh.storagePath || fresh.photoPath || fresh.fullPath || fresh.path || "").trim();
        console.log("[ShelfScan] after process", {
            venueId,
            jobId,
            photoPath,
            hasDownloadUrl: !!fresh.downloadUrl,
        });
        if (!photoPath) {
            await ref.set({
                status: "done",
                hasDownloadUrl: false,
                debug: {
                    ...(fresh.debug || {}),
                    reason: "missing-photoPath-after-process",
                    availableKeys: Object.keys(fresh || {}),
                },
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });
            console.log("[ShelfScan] DONE (no photoPath)", { venueId, jobId });
            return;
        }
        const ensured = await ensureDownloadUrl(photoPath);
        if (!ensured.ok) {
            await ref.set({
                status: "done",
                hasDownloadUrl: false,
                debug: { ...(fresh.debug || {}), ensured },
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });
            console.log("[ShelfScan] DONE (no downloadUrl)", ensured);
            return;
        }
        const out = {
            status: "done",
            hasDownloadUrl: true,
            bucket: ensured.bucket,
            fullPath: ensured.fullPath,
            downloadUrl: ensured.downloadUrl,
            bytes: ensured.bytes,
            contentType: ensured.contentType,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        console.log("[ShelfScan] DONE RETURNING:", out);
        await ref.set(out, { merge: true });
        return;
    }
    catch (e) {
        console.error("[ShelfScan] failed", e);
        await ref.set({
            status: "failed",
            error: { message: e?.message || String(e) },
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        return;
    }
});
//# sourceMappingURL=onShelfScanJobCreate.js.map