// Dev credentials — read from environment variables (never hardcoded)
// These are set in .env locally and in EAS Secrets for builds
export const DEV_EMAIL: string = process.env.EXPO_PUBLIC_DEV_EMAIL ?? '';
export const DEV_PASSWORD: string = process.env.EXPO_PUBLIC_DEV_PASSWORD ?? '';
export const DEV_VENUE_ID: string | null = process.env.EXPO_PUBLIC_DEV_VENUE_ID ?? null;

const listRaw = (process.env.EXPO_PUBLIC_DEV_EMAIL_ALLOWLIST ?? DEV_EMAIL) as string;
export const DEV_EMAIL_ALLOWLIST: string[] = String(listRaw)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export const IS_DEV_PIN_ENABLED = !!DEV_VENUE_ID;

export function isDevEmail(email?: string | null) {
  if (!email) return false;
  return email === DEV_EMAIL || DEV_EMAIL_ALLOWLIST.includes(email);
}
