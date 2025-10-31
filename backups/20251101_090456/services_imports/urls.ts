// @ts-nocheck
const UPLOAD = process.env.EXPO_PUBLIC_UPLOAD_CSV_URL;
const PROCESS = process.env.EXPO_PUBLIC_PROCESS_PRODUCTS_CSV_URL;

if (!UPLOAD || !PROCESS) {
  // Fail loudly in dev so we don't chase ghosts
  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.warn('[CSV URLs] Missing env. Check .env for EXPO_PUBLIC_UPLOAD_CSV_URL and EXPO_PUBLIC_PROCESS_PRODUCTS_CSV_URL');
  }
}

export const CSV_UPLOAD_URL = String(UPLOAD || '').trim();
export const CSV_PROCESS_URL = String(PROCESS || '').trim();
