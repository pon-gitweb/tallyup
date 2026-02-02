// @ts-nocheck
import * as functions from "firebase-functions";
import * as admin from "firebase-admin";

if (!admin.apps.length) admin.initializeApp();

export const onShelfScanJobCreate = functions
  .region("us-central1")
  .firestore
  .document("venues/{venueId}/shelfScanJobs/{jobId}")
  .onCreate(async (snap, ctx) => {
    const { venueId, jobId } = ctx.params;

    // Minimal stub: mark as queued so client can see lifecycle.
    // Replace with real OCR pipeline later.
    await snap.ref.set(
      {
        status: "queued",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return null;
  });
