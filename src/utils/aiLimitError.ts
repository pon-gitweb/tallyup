// @ts-nocheck
import { Alert, Linking } from 'react-native';

/**
 * Call after any AI fetch response.
 * Returns true if a limit_reached error was detected and Alert shown.
 * Client should return early if this returns true.
 */
export function handleAiLimitError(json: any): boolean {
  if (json?.error !== 'limit_reached') return false;
  const msg = json.message || 'You have reached your monthly AI limit.';
  Alert.alert('Monthly limit reached', msg, [
    { text: 'OK' },
    { text: 'Contact us', onPress: () => Linking.openURL('mailto:office@hosti.co.nz') },
  ]);
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
