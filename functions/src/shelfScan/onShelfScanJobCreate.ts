// @ts-nocheck
import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { processShelfScanJob } from "./processShelfScanJob";
import { randomUUID } from "crypto";

if (!admin.apps.length) admin.initializeApp();

const BUCKET_NAME =
  process.env.FIREBASE_STORAGE_BUCKET ||
  process.env.STORAGE_BUCKET ||
  (admin.app().options as any)?.storageBucket ||
  "tallyup-f1463.firebasestorage.app";

function buildDownloadUrl(bucket: string, fullPath: string, token: string) {
  return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(
    fullPath
  )}?alt=media&token=${token}`;
}

async function ensureDownloadUrl(fullPath: string) {
  const bucket = admin.storage().bucket(BUCKET_NAME);
  const file = bucket.file(fullPath);

  const [exists] = await file.exists();
  if (!exists) {
    return { ok: false, reason: "file-not-found", bucket: bucket.name, fullPath };
  }

  let [meta] = await file.getMetadata();
  let token =
    meta?.metadata?.firebaseStorageDownloadTokens ||
    meta?.metadata?.firebaseStorageDownloadToken ||
    "";

  if (typeof token === "string" && token.includes(",")) token = token.split(",")[0].trim();

  if (!token) {
    token = randomUUID();
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

export const onShelfScanJobCreate = functions
  .region("us-central1")
  .firestore.document("venues/{venueId}/shelfScanJobs/{jobId}")
  .onCreate(async (snap, ctx) => {
    const { venueId, jobId } = ctx.params as any;
    const ref = snap.ref;
    const data = snap.data() || {};

    console.log("[ShelfScan] start", { venueId, jobId, keys: Object.keys(data || {}) });

    await ref.set(
      {
        status: "processing",
        debug: { createdKeys: Object.keys(data || {}) },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    try {
      await processShelfScanJob({ venueId, jobId });

      const freshSnap = await ref.get();
      const fresh = freshSnap.data() || {};

      const photoPath = String(
        fresh.storagePath || fresh.photoPath || fresh.fullPath || fresh.path || ""
      ).trim();

      console.log("[ShelfScan] after process", {
        venueId,
        jobId,
        photoPath,
        hasDownloadUrl: !!fresh.downloadUrl,
      });

      if (!photoPath) {
        await ref.set(
          {
            status: "done",
            hasDownloadUrl: false,
            debug: {
              ...(fresh.debug || {}),
              reason: "missing-photoPath-after-process",
              availableKeys: Object.keys(fresh || {}),
            },
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        console.log("[ShelfScan] DONE (no photoPath)", { venueId, jobId });
        return;
      }

      const ensured = await ensureDownloadUrl(photoPath);

      if (!ensured.ok) {
        await ref.set(
          {
            status: "done",
            hasDownloadUrl: false,
            debug: { ...(fresh.debug || {}), ensured },
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
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
    } catch (e: any) {
      console.error("[ShelfScan] failed", e);
      await ref.set(
        {
          status: "failed",
          error: { message: e?.message || String(e) },
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      return;
    }
  });
