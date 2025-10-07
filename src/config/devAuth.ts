export const DEV_DEFAULT_EMAIL = 'test@example.com';
export const DEV_DEFAULT_PASSWORD = 'password123';

/** Dev helper used by LoginScreen; returns canned creds. */
export async function devLogin() {
  return { email: DEV_DEFAULT_EMAIL, password: DEV_DEFAULT_PASSWORD };
}
