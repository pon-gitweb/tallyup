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
const admin = __importStar(require("firebase-admin"));
const now = () => admin.firestore.FieldValue.serverTimestamp();
async function processShelfScanJob(params) {
    const { venueId, jobId } = params;
    const db = admin.firestore();
    const jobRef = db.doc(`venues/${venueId}/shelfScanJobs/${jobId}`);
    const snap = await jobRef.get();
    if (!snap.exists)
        return;
    const job = snap.data();
    // Process only once
    if (!job || job.status !== "uploaded")
        return;
    await jobRef.update({
        status: "processing",
        updatedAt: now(),
        processingStartedAt: now(),
    });
    try {
        const storagePath = job.storagePath;
        if (!storagePath)
            throw new Error("Missing storagePath on job");
        // Validate the file exists (catches path/rules mismatches fast)
        const bucket = admin.storage().bucket();
        const file = bucket.file(storagePath);
        const [exists] = await file.exists();
        if (!exists)
            throw new Error(`Storage file not found at ${storagePath}`);
        // MVP: return a deterministic dummy proposal so the UI proves end-to-end
        const proposals = [
            { key: "p1", name: "Example item (edit me)", itemId: null, count: 1, confidence: 0.5, isNew: true },
        ];
        await jobRef.update({
            status: "done",
            updatedAt: now(),
            processedAt: now(),
            result: { proposals, source: "dummy-v1" },
        });
    }
    catch (e) {
        await jobRef.update({
            status: "failed",
            updatedAt: now(),
            failedAt: now(),
            error: { message: e?.message ?? String(e) },
        });
    }
}
//# sourceMappingURL=processShelfScanJob.js.map