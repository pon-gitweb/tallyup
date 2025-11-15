import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

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
export const ocrSupplierCard = functions
  .region('us-central1')
  .https.onCall(async (data, context) => {
    const uid = context.auth?.uid || null;
    if (!uid) {
      throw new functions.https.HttpsError('unauthenticated', 'Sign-in required.');
    }

    const venueId = (data && data.venueId) as string | undefined;
    const imageBase64 = (data && data.imageBase64) as string | undefined;

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
    } catch (e) {
      functions.logger.warn('[ocrSupplierCard] audit write failed', (e as any)?.message);
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
