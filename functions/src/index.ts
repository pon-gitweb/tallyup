import * as admin from "firebase-admin";

// Initialize Admin exactly once (safe on hot reload)
try {
  admin.app();
} catch {
  admin.initializeApp();
}

// === Membership (claims sync + callable) ===
export { onMemberWrite, refreshMyClaims } from "./membership";

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
