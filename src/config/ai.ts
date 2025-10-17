/**
 * AI runtime config for Suggested Orders (Expo-safe, no native).
 * - Platform-aware base URL: Android emulator → 10.0.2.2; iOS/Web → localhost.
 * - Exports exactly what suggestAI.ts and SuggestedOrderScreen.tsx import.
 */
import { Platform } from 'react-native';

const LOCAL_BASE =
  Platform.OS === 'android' ? 'http://10.0.2.2:3001' : 'http://localhost:3001';

/** Master toggle: when false, app always uses math suggester */
export const USE_AI_SUGGESTER = true;

/** AI suggest endpoint + optional API key */
export const AI_SUGGEST_URL = `${LOCAL_BASE}/api/ai/suggest`;
export const AI_SUGGEST_API_KEY = ''; // leave blank if your server doesn't require it

/** Request tuning (names expected by suggestAI.ts) */
export const AI_REQUEST_TIMEOUT_MS = 12000;
export const AI_HISTORY_DAYS = 90;

/** Paywall endpoints (used by services/entitlement.ts) */
export const ENTITLEMENT_URL = `${LOCAL_BASE}/api/entitlement`;
export const VALIDATE_CODE_URL = `${LOCAL_BASE}/api/validate-promo`;

/** Local developer bypass codes (accepted client-side only) */
export const DEV_BYPASS_CODES: string[] = ['DEV-AI-OPEN', 'QA-BYPASS-2025'];
