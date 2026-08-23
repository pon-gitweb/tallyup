// @ts-nocheck
import { Alert, Linking } from 'react-native';
import { getAuth } from 'firebase/auth';

const API = 'https://us-central1-tallyup-f1463.cloudfunctions.net/api';

// Return URLs after Stripe checkout on mobile: the web-app's billing pages.
// The purchase completes via webhook regardless of where Stripe redirects —
// these URLs are just the post-checkout landing page in the device browser.
// A proper deep-link return path is a future improvement.
const MOBILE_SUCCESS_URL = 'https://tallyup-f1463.web.app/app/billing-success';
const MOBILE_CANCEL_URL  = 'https://tallyup-f1463.web.app/app/billing-cancel';

async function openAiMeterExtensionCheckout(venueId: string): Promise<void> {
  try {
    const auth = getAuth();
    const token = await auth.currentUser?.getIdToken().catch(() => null);
    if (!token) {
      Alert.alert('Sign in required', 'Please sign in again to purchase.');
      return;
    }
    const res = await fetch(`${API}/stripe/create-one-off-checkout-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        venueId,
        lookupKey: 'ai_meter_extension',
        successUrl: MOBILE_SUCCESS_URL,
        cancelUrl: MOBILE_CANCEL_URL,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.url) {
      Alert.alert('Purchase unavailable', data.error || 'Could not open checkout. Please try again or contact office@hosti.co.nz.');
      return;
    }
    await Linking.openURL(data.url);
  } catch {
    Alert.alert('Purchase unavailable', 'Could not open checkout. Please try again or contact office@hosti.co.nz.');
  }
}

/**
 * Call after any AI fetch response.
 * Returns true if a limit_reached error was detected and Alert shown.
 * Client should return early if this returns true.
 *
 * Pass venueId to enable the "Buy AI Meter Extension" button.
 * When venueId is absent the Alert falls back to Contact-us only.
 */
export function handleAiLimitError(json: any, venueId?: string): boolean {
  if (json?.error !== 'limit_reached') return false;
  const msg = json.message || 'You have reached your monthly AI limit.';

  const buttons = [
    { text: 'OK' },
    { text: 'Contact us', onPress: () => Linking.openURL('mailto:office@hosti.co.nz') },
  ];

  if (venueId) {
    buttons.push({
      text: 'Buy AI Meter Extension — $40',
      onPress: () => { openAiMeterExtensionCheckout(venueId); },
    });
  }

  Alert.alert('Monthly limit reached', msg, buttons);
  return true;
}

/**
 * Check for 80% usage warning and return toast text if present.
 * Show as a non-blocking toast — do not call Alert.
 */
export function getUsageWarningToast(json: any): string | null {
  const w = json?.usageWarning;
  if (!w || !w.message) return null;
  return `📊 ${w.percentUsed}% of ${w.feature.replace(/_/g, ' ')} allowance used this month`;
}
