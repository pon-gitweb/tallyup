/**
 * Optional Firestore logger.
 * If firebase-admin is available + ADC/SA creds are set, logs to:
 *   venues/{venueId}/aiRuns/{autoId}
 * Otherwise falls back to a local logs/*.json file.
 */
const fs = require('fs');
const path = require('path');

function initAdminIfAvailable() {
  try {
    // Lazy require so this file works even if firebase-admin isn't installed
    const { initializeApp, getApps, cert, applicationDefault } = require('firebase-admin/app');
    const { getFirestore } = require('firebase-admin/firestore');

    const app =
      getApps().length
        ? getApps()[0]
        : initializeApp({
            credential: process.env.GOOGLE_APPLICATION_CREDENTIALS
              ? cert(require(process.env.GOOGLE_APPLICATION_CREDENTIALS))
              : applicationDefault(),
            projectId: process.env.FIREBASE_PROJECT_ID || undefined,
          });

    const db = getFirestore(app);
    console.log('[AI SERVER] Firestore admin available: logging to Firestore');
    return db;
  } catch (e) {
    console.log('[AI SERVER] firebase-admin not available — logging to local files only');
    return null;
  }
}

async function logSuggestion(db, payload) {
  const safe = {
    venueId: String(payload?.venueId || ''),
    request: payload?.request || {},
    response: payload?.response || {},
    meta: {
      at: new Date().toISOString(),
      source: 'ai.suggest-orders',
      version: 1,
    },
  };

  if (db) {
    // Firestore path: venues/{venueId}/aiRuns/{autoId}
    try {
      const col = db.collection('venues').doc(safe.venueId).collection('aiRuns');
      await col.add(safe);
      return;
    } catch (err) {
      console.warn('[AI SERVER] Firestore log failed, falling back to file:', err?.message);
    }
  }

  // Local file fallback
  try {
    const file = path.join(__dirname, '..', 'logs', `aiRun-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(safe, null, 2));
  } catch (err) {
    console.warn('[AI SERVER] file log failed:', err?.message);
  }
}

module.exports = { initAdminIfAvailable, logSuggestion };
