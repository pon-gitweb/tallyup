import Constants from 'expo-constants';

const EXTRA: any =
  (Constants?.expoConfig?.extra as any) ??
  ((Constants as any)?.manifest2?.extra as any) ??
  {};

// Dev credentials & gating — with sane defaults for local dev
export const DEV_EMAIL: string = EXTRA.EXPO_PUBLIC_DEV_EMAIL ?? 'test@example.com';
export const DEV_PASSWORD: string = EXTRA.EXPO_PUBLIC_DEV_PASSWORD ?? 'test1234';
export const DEV_VENUE_ID: string | null = EXTRA.EXPO_PUBLIC_DEV_VENUE_ID ?? null;

// Comma-separated allowlist in app config, defaults to DEV_EMAIL
const listRaw = (EXTRA.EXPO_PUBLIC_DEV_EMAIL_ALLOWLIST ?? DEV_EMAIL) as string;
export const DEV_EMAIL_ALLOWLIST: string[] = String(listRaw)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export const IS_DEV_PIN_ENABLED = !!DEV_VENUE_ID;

// Only these emails are allowed to be auto-attached to DEV_VENUE_ID
export function isDevEmail(email?: string | null) {
  if (!email) return false;
  return email === DEV_EMAIL || DEV_EMAIL_ALLOWLIST.includes(email);
}
