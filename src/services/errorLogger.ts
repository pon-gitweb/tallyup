// @ts-nocheck
/**
 * ErrorLogger — logs errors to Firestore for visibility
 * Gives you a window into what's breaking in the field
 */
import { getFirestore, collection, addDoc, serverTimestamp } from 'firebase/firestore';

export async function logError(context: string, error: any, extras?: Record<string, any>): Promise<void> {
  try {
    const db = getFirestore();
    await addDoc(collection(db, 'errorLogs'), {
      context,
      message: error?.message || String(error),
      stack: error?.stack?.slice(0, 500) || null,
      extras: extras || null,
      platform: 'android',
      loggedAt: serverTimestamp(),
    });
  } catch {
    // Never let error logging itself crash the app
  }
}
