import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';

const db = admin.firestore();

async function extractCardWithClaude(imageBase64: string): Promise<{
  supplierName: string;
  contactName: string;
  email: string;
  phone: string;
  address: string;
  website: string;
}> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const system = [
    'You are reading a supplier business card image.',
    'Extract contact details and return ONLY valid JSON, no markdown, no explanation:',
    '{"supplierName":"...","contactName":"...","email":"...","phone":"...","address":"...","website":"..."}',
    'supplierName: the company or organisation name — usually the largest text or prominent logo text.',
    'contactName: the individual person\'s name printed on the card.',
    'Use empty string "" for any field not found on the card.',
    'Return only valid JSON, no preamble.',
  ].join('\n');

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 } },
          { type: 'text', text: 'Extract all contact details from this business card.' },
        ],
      }],
    }),
  });

  if (!resp.ok) throw new Error('Claude supplier card error: ' + resp.status);
  const data = await resp.json() as any;
  const text = data?.content?.[0]?.text || '{}';
  const match = text.match(/\{[\s\S]*\}/);
  const parsed = match ? JSON.parse(match[0]) : {};

  return {
    supplierName: String(parsed.supplierName || '').trim(),
    contactName: String(parsed.contactName || '').trim(),
    email: String(parsed.email || '').trim(),
    phone: String(parsed.phone || '').trim(),
    address: String(parsed.address || '').trim(),
    website: String(parsed.website || '').trim(),
  };
}

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

    functions.logger.info('[ocrSupplierCard] start', { uid, venueId, base64Length: imageBase64.length });

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

    try {
      const result = await extractCardWithClaude(imageBase64);
      functions.logger.info('[ocrSupplierCard] OK', { uid, venueId, supplierName: result.supplierName });
      return { ok: true, ...result };
    } catch (e: any) {
      functions.logger.error('[ocrSupplierCard] extraction failed', e?.message);
      throw new functions.https.HttpsError('internal', 'Could not read business card: ' + (e?.message || 'unknown error'));
    }
  });
