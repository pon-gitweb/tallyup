import * as admin from "firebase-admin";

type Proposal = {
  key: string;
  name: string;
  itemId?: string | null;
  count: number;
  confidence?: number | null;
  isNew?: boolean;
};

const now = () => admin.firestore.FieldValue.serverTimestamp();

export async function processShelfScanJob(params: { venueId: string; jobId: string }) {
  const { venueId, jobId } = params;

  const db = admin.firestore();
  const jobRef = db.doc(`venues/${venueId}/shelfScanJobs/${jobId}`);
  const snap = await jobRef.get();
  if (!snap.exists) return;

  const job = snap.data() as any;

  // Process only once
  if (!job || job.status !== "uploaded") return;

  await jobRef.update({
    status: "processing",
    updatedAt: now(),
    processingStartedAt: now(),
  });

  try {
    const storagePath = job.storagePath as string | undefined;
    if (!storagePath) throw new Error("Missing storagePath on job");

    // Validate the file exists (catches path/rules mismatches fast)
    const bucket = admin.storage().bucket();
    const file = bucket.file(storagePath);
    const [exists] = await file.exists();
    if (!exists) throw new Error(`Storage file not found at ${storagePath}`);

    // MVP: return a deterministic dummy proposal so the UI proves end-to-end
    const proposals: Proposal[] = [
      { key: "p1", name: "Example item (edit me)", itemId: null, count: 1, confidence: 0.5, isNew: true },
    ];

    await jobRef.update({
      status: "done",
      updatedAt: now(),
      processedAt: now(),
      result: { proposals, source: "dummy-v1" },
    });
  } catch (e: any) {
    await jobRef.update({
      status: "failed",
      updatedAt: now(),
      failedAt: now(),
      error: { message: e?.message ?? String(e) },
    });
  }
}
