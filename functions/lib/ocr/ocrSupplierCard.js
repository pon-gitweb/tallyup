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
exports.ocrSupplierCard = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const db = admin.firestore();
/**
 * Callable: ocrSupplierCard
 *
 * Input: { venueId: string, imageBase64: string }
 * Auth: required
 *
 * STUB IMPLEMENTATION:
 *   - No Storage used
 *   - No bucket permissions needed
 *   - Image processed entirely in-memory
 *   - Returns mocked supplier fields for now
 */
exports.ocrSupplierCard = functions
    .region('us-central1')
    .https.onCall(async (data, context) => {
    const uid = context.auth?.uid || null;
    if (!uid) {
        throw new functions.https.HttpsError('unauthenticated', 'Sign-in required.');
    }
    const venueId = (data && data.venueId);
    const imageBase64 = (data && data.imageBase64);
    if (!venueId || typeof venueId !== 'string') {
        throw new functions.https.HttpsError('invalid-argument', 'venueId is required.');
    }
    if (!imageBase64 || typeof imageBase64 !== 'string') {
        throw new functions.https.HttpsError('invalid-argument', 'imageBase64 is required.');
    }
    functions.logger.info('[ocrSupplierCard] start', {
        uid,
        venueId,
        base64Length: imageBase64.length,
    });
    try {
        await db.collection('venues').doc(venueId)
            .collection('ocrSupplierAudits')
            .add({
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            uid,
            base64Length: imageBase64.length,
            source: 'supplier-card',
        });
    }
    catch (e) {
        functions.logger.warn('[ocrSupplierCard] audit write failed', e?.message);
    }
    const result = {
        ok: true,
        supplierName: 'Sample Supplier Ltd',
        contactName: 'Alex Sample',
        email: 'orders@samplesupplier.test',
        phone: '+64 21 123 4567',
        address: '123 Sample Street, Testville, NZ',
        website: 'https://samplesupplier.test',
    };
    functions.logger.info('[ocrSupplierCard] returning stub result', {
        uid,
        venueId,
        result,
    });
    return result;
});
//# sourceMappingURL=ocrSupplierCard.js.map