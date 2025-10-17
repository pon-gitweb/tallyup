/**
 * AI runtime configuration and paywall / bypass codes.
 *
 * - USE_AI_SUGGESTER: enables AI mode if true.
 * - AI_SUGGEST_URL:   backend endpoint for AI suggestions.
 * - AI_SUGGEST_API_KEY: optional API key if your endpoint requires it.
 *
 * - ENTITLEMENT_URL: endpoint for checking paywall entitlement.
 * - VALIDATE_CODE_URL: optional endpoint to validate promo/bypass codes.
 *
 * - DEV_BYPASS_CODES: local developer codes that unlock AI (for testing only).
 */

export const USE_AI_SUGGESTER = true;

export const AI_SUGGEST_URL = ''; // e.g. 'https://api.stackmosaic.ai/v1/suggest-orders'
export const AI_SUGGEST_API_KEY = ''; // optional

// Paywall endpoints
export const ENTITLEMENT_URL = ''; // e.g. 'https://billing.stackmosaic.ai/api/entitlement'
export const VALIDATE_CODE_URL = ''; // e.g. 'https://billing.stackmosaic.ai/api/validate-promo'

// Local developer bypass codes
export const DEV_BYPASS_CODES: string[] = [
  'DEV-AI-OPEN',
  'QA-BYPASS-2025',
];

// Default limits for AI request history
export const DEFAULT_AI_HISTORY_DAYS = 90;
export const AI_MAX_HISTORY_DAYS = 730; // 2 years
