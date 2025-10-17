/**
 * Entitlement and promo validation services.
 * These check whether a user or venue has AI access, and handle promo code unlocks.
 */

import { ENTITLEMENT_URL, VALIDATE_CODE_URL, DEV_BYPASS_CODES, DEFAULT_AI_HISTORY_DAYS, AI_MAX_HISTORY_DAYS } from '../config/ai';
import { fetchWithTimeout } from '../utils/net';

export type Entitlement = {
  allowed: boolean;
  allowedHistoryDays: number;
  reason?: string;
  expiresAt?: string | null;
};

// Check AI entitlement for a given venue
export async function checkEntitlement(venueId: string, opts: { token?: string } = {}): Promise<Entitlement> {
  // Local dev bypass (always allow in Expo dev mode)
  if (__DEV__) {
    return { allowed: true, allowedHistoryDays: DEFAULT_AI_HISTORY_DAYS };
  }

  if (!ENTITLEMENT_URL) {
    return { allowed: false, allowedHistoryDays: 0, reason: 'not_configured' };
  }

  try {
    const res = await fetchWithTimeout(ENTITLEMENT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      },
      body: JSON.stringify({ venueId }),
    }, 10000);

    if (!res.ok) {
      return { allowed: false, allowedHistoryDays: 0, reason: `http_${res.status}` };
    }

    const json = await res.json();
    const allowedHistoryDays = Math.min(
      Number(json.allowedHistoryDays || DEFAULT_AI_HISTORY_DAYS),
      AI_MAX_HISTORY_DAYS
    );

    return {
      allowed: !!json.allowed,
      allowedHistoryDays,
      expiresAt: json.expiresAt || null,
    };
  } catch (err: any) {
    return { allowed: false, allowedHistoryDays: 0, reason: err?.message || 'network_error' };
  }
}

// Validate a promo or dev bypass code
export async function validatePromoCode(code: string, venueId?: string): Promise<{ success: boolean; message?: string; allowedHistoryDays?: number }> {
  // Local bypass list
  if (DEV_BYPASS_CODES.includes(String(code).trim())) {
    return { success: true, message: 'dev_bypass', allowedHistoryDays: DEFAULT_AI_HISTORY_DAYS };
  }

  if (!VALIDATE_CODE_URL) {
    return { success: false, message: 'validation_not_configured' };
  }

  try {
    const res = await fetchWithTimeout(VALIDATE_CODE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: String(code).trim(), venueId }),
    }, 10000);

    if (!res.ok) {
      return { success: false, message: `http_${res.status}` };
    }

    const json = await res.json();
    return {
      success: !!json.success,
      allowedHistoryDays: json.allowedHistoryDays,
      message: json.message,
    };
  } catch (err: any) {
    return { success: false, message: err?.message || 'network_error' };
  }
}
