import AsyncStorage from '@react-native-async-storage/async-storage';

// TEMP (local-only): 2 free FULL stocktakes.
// Replace with Firestore entitlements later.
export const TRIAL_ST_KEY = 'trial_stocktakes_completed_v1';
export const TRIAL_ST_LIMIT = 2;

export async function getStocktakeTrialState(): Promise<{ used: number; left: number; limit: number }> {
  const raw = await AsyncStorage.getItem(TRIAL_ST_KEY);
  const used = Math.max(0, Number(raw ?? '0'));
  const left = Math.max(0, TRIAL_ST_LIMIT - used);
  return { used, left, limit: TRIAL_ST_LIMIT };
}

export async function canStartStocktakeTrial(): Promise<{ ok: boolean; left: number }> {
  const { left } = await getStocktakeTrialState();
  return { ok: left > 0, left };
}

// Increment-on-submit (NOT on start)
export async function incrementFullStocktakeCompleted(): Promise<void> {
  const raw = await AsyncStorage.getItem(TRIAL_ST_KEY);
  const used = Math.max(0, Number(raw ?? '0'));
  await AsyncStorage.setItem(TRIAL_ST_KEY, String(used + 1));
}
