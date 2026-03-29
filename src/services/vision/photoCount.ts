// @ts-nocheck
/**
 * Photo Count Service
 * Human-in-the-loop AI stock counting via camera.
 *
 * Flow:
 * 1. User photographs a shelf section
 * 2. Claude Vision analyses the image and estimates count
 * 3. User sees the suggestion with reasoning
 * 4. User confirms or adjusts
 * 5. Correction is recorded for learning
 */

import { getAuth } from 'firebase/auth';
import * as FileSystem from 'expo-file-system';
import { doc, addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';

const AI_BASE = (typeof process !== 'undefined' && process?.env?.EXPO_PUBLIC_AI_URL)
  ? String(process.env.EXPO_PUBLIC_AI_URL)
  : 'https://us-central1-tallyup-f1463.cloudfunctions.net/api';

export type PhotoCountResult = {
  estimatedCount: number;
  confidence: number;
  productName?: string | null;
  reasoning?: string | null;
  suggestions?: string[];
};

export type PhotoCountCorrection = {
  venueId: string;
  productId?: string | null;
  productName?: string | null;
  aiEstimate: number;
  aiConfidence: number;
  userCount: number;
  delta: number;
  imageUri?: string | null;
  recordedAt: any;
};

/**
 * Analyse a photo for stock count using Claude Vision.
 * @param localUri - local file URI from camera
 * @param productHint - optional product name to guide Claude
 * @param unit - optional unit (bottles, cans, kg)
 */
export async function analyzePhotoForCount(
  localUri: string,
  productHint?: string | null,
  unit?: string | null,
): Promise<PhotoCountResult> {
  const auth = getAuth();
  const token = await auth.currentUser?.getIdToken().catch(() => null);
  if (!token) throw new Error('Not authenticated');

  // Read image as base64
  const base64 = await FileSystem.readAsStringAsync(localUri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  const venueId = (auth.currentUser as any)?.venueId || null;

  const resp = await fetch(AI_BASE + '/photo-count', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token,
    },
    body: JSON.stringify({
      venueId: venueId || 'unknown',
      imageBase64: base64,
      productHint: productHint || null,
      unit: unit || null,
    }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({})) as any;
    throw new Error(err?.error || 'Photo count failed');
  }

  const data = await resp.json() as any;
  return {
    estimatedCount: data.estimatedCount ?? 0,
    confidence: data.confidence ?? 0,
    productName: data.productName ?? null,
    reasoning: data.reasoning ?? null,
    suggestions: data.suggestions ?? [],
  };
}

/**
 * Record a user correction for AI learning.
 * Called after user confirms or adjusts the AI count.
 */
export async function recordPhotoCountCorrection(
  venueId: string,
  correction: Omit<PhotoCountCorrection, 'recordedAt'>,
): Promise<void> {
  try {
    await addDoc(
      collection(db, 'venues', venueId, 'photoCountCorrections'),
      { ...correction, recordedAt: serverTimestamp() }
    );
  } catch {
    // Non-fatal — learning data is best effort
  }
}
