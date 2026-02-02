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
exports.processShelfScanJob = processShelfScanJob;
// @ts-nocheck
const admin = __importStar(require("firebase-admin"));
if (!admin.apps.length)
    admin.initializeApp();
async function processShelfScanJob({ venueId, jobId }) {
    const db = admin.firestore();
    const ref = db.doc(`venues/${venueId}/shelfScanJobs/${jobId}`);
    const snap = await ref.get();
    const job = snap.data() || {};
    console.log("[ShelfScan] start", { venueId, jobId, keys: Object.keys(job) });
    // Expect at least one of these to exist
    const photoPath = job.photoPath || job.fullPath || job.storagePath || job.path;
    const downloadUrl = job.downloadUrl || job.photoUrl || job.url;
    console.log("[ShelfScan] inputs", { photoPath, hasDownloadUrl: !!downloadUrl });
    // Fail fast if missing photo
    if (!photoPath && !downloadUrl) {
        await ref.set({
            status: "failed",
            error: { message: "Missing photoPath/downloadUrl on job. Upload succeeded but job doc lacks a usable path." },
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            failedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        return;
    }
    // TODO: Replace this stub with your real OCR/AI parsing.
    // For now, prove the pipeline end-to-end by returning a deterministic proposal.
    const proposals = [
        { name: "TEST ITEM", count: 1, confidence: 0.1 }
    ];
    await ref.set({
        status: "done",
        result: { proposals },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        doneAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    console.log("[ShelfScan] done", { venueId, jobId, proposals: proposals.length });
}
//# sourceMappingURL=processShelfScanJob.js.map