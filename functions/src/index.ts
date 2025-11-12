import * as admin from 'firebase-admin';

// Initialize Admin exactly once (safe on hot-reload)
try { admin.app(); } catch { admin.initializeApp(); }

// === Membership (claims sync + callable) ===
export { onMemberWrite, refreshMyClaims } from './membership';
export { onOcrJobQueued } from './ocr/parseInvoice';

// === OCR callable ===
export { ocrFastReceivePhoto } from './ocrFastReceivePhoto';
