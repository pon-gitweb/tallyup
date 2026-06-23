import * as admin from "firebase-admin";
import * as functions from "firebase-functions";
import { deleteVenueAllData } from "./api";

// Initialize Admin exactly once (safe on hot reload)
try {
  admin.app();
} catch {
  admin.initializeApp();
}

// === Membership (claims sync + callable) ===
export { onMemberWrite, refreshMyClaims } from "./membership";

// === Invites (send email + accept callable) ===
export { onInviteCreated, acceptInviteCallable } from "./invites";

// === Invoice OCR job queue (PDF/CSV etc) ===
export { onOcrJobQueued } from "./ocr/parseInvoice";

// === Fast Receive photo OCR (uses fastReceives snapshots) ===
export { ocrFastReceivePhoto } from "./ocrFastReceivePhoto";

// === Supplier card OCR ===
export { ocrSupplierCard } from "./ocr/ocrSupplierCard";

// === Invoice photo OCR (direct photo → lines) ===
export { ocrInvoicePhoto } from "./ocrInvoicePhoto";

// === NEW: create venue from mobile app ===
export { createVenueOwnedByUser } from "./createVenueOwnedByUser";

// === NEW: Sales PDF normaliser (used by SalesImportPanel) ===
export { processSalesPdf } from "./processSalesPdf";

// === HTTP API (upload-file, health) ===
export { api } from "./api";

// === Weekly summary email (scheduled, Monday 8am venue local time) ===
export { weeklySummaryEmail } from "./weeklySummary";

// === Global supplier directory — seed + contribute from invoice scans ===
export { seedGlobalSuppliers } from "./globalSuppliers";

// === Pilot analytics — writes to venues/{venueId}/analyticsEvents ===
// Stream analyticsEvents to BigQuery via:
//   firebase ext:install firebase/firestore-bigquery-export
export { onStocktakeCompleted, onOrderSubmitted, onAiFeatureUsed } from "./analytics";

// === Bar item velocity threshold push notifications ===
export { onBarItemVelocityUpdate } from "./barItemNotifications";

// === Product price-change cascade to recipe COGS ===
export { onProductPriceChanged } from "./priceCascade";

// === Soft-deleted venue hard-delete sweep ===
// Runs hourly — for any venue past its 48h recovery window (set by
// POST /deleteVenue), permanently removes all its data. Venues restored via
// POST /restoreVenue before this fires are skipped (scheduledHardDeleteAt is cleared).
export const scheduledHardDelete = functions
  .region("us-central1")
  .runWith({ memory: "512MB", timeoutSeconds: 540 })
  .pubsub.schedule("every 1 hours")
  .onRun(async () => {
    const db = admin.firestore();

    let dueSnap: FirebaseFirestore.QuerySnapshot;
    try {
      dueSnap = await db.collection("venues").where("scheduledHardDeleteAt", "<=", new Date()).get();
    } catch (e) {
      console.error("[scheduledHardDelete] failed to query due venues:", e);
      return null;
    }

    if (dueSnap.empty) {
      console.log("[scheduledHardDelete] no venues due for hard delete this run");
      return null;
    }

    for (const venueDoc of dueSnap.docs) {
      const venueId = venueDoc.id;
      try {
        await deleteVenueAllData(db, venueId);
        console.log(`[scheduledHardDelete] hard-deleted venueId=${venueId}`);
      } catch (e: any) {
        console.error(`[scheduledHardDelete] failed to hard-delete venueId=${venueId}:`, e?.message || e);
      }
    }

    return null;
  });

// === Legacy functions — deployed directly, must remain exported to avoid deletion ===
export {
  processInvoicesCsv,
  processInvoicesPdf,
  processSalesCsv,
  processProductsCsv,
  uploadCsv,
  uploadShelfScanPhotoCallable,
  onShelfScanJobCreate,
  varianceDepartmentReport,
  aiVarianceExplain,
  allocatePo,
  ensureVenueDefaultsCallable,
} from "./legacyFunctions";
