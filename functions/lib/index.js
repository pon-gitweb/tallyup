"use strict";

const admin = require("firebase-admin");

// Initialize Admin exactly once (safe on hot reload)
try {
  admin.app();
} catch {
  admin.initializeApp();
}

// === Membership (claims sync + callable) ===
const membership = require("./membership");
exports.onMemberWrite = membership.onMemberWrite;
exports.refreshMyClaims = membership.refreshMyClaims;

// === Invoice OCR job queue (PDF/CSV etc) ===
const parseInvoice = require("./ocr/parseInvoice");
exports.onOcrJobQueued = parseInvoice.onOcrJobQueued;

// === Fast Receive photo OCR (uses fastReceives snapshots) ===
const fastPhoto = require("./ocrFastReceivePhoto");
exports.ocrFastReceivePhoto = fastPhoto.ocrFastReceivePhoto;

// === Supplier card OCR ===
const supplierCard = require("./ocr/ocrSupplierCard");
exports.ocrSupplierCard = supplierCard.ocrSupplierCard;

// === Invoice photo OCR (direct photo → lines) ===
const invoicePhoto = require("./ocrInvoicePhoto");
exports.ocrInvoicePhoto = invoicePhoto.ocrInvoicePhoto;
