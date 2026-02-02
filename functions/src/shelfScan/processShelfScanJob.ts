// @ts-nocheck
import * as admin from "firebase-admin";

if (!admin.apps.length) admin.initializeApp();

export async function processShelfScanJob({ venueId, jobId }:{ venueId:string; jobId:string }) {
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
