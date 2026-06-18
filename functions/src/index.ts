import * as admin from "firebase-admin";

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
