// @ts-nocheck
import * as Sentry from '@sentry/react-native';

const DSN =
  process.env.EXPO_PUBLIC_SENTRY_DSN ||
  'https://10945fa61dcadabd7534d19dd003be7d@o4511163676164096.ingest.us.sentry.io/4511214931935232';

export function initCrashReporting() {
  Sentry.init({
    dsn: DSN,
    environment: __DEV__ ? 'development' : 'production',
    debug: __DEV__,
    tracesSampleRate: __DEV__ ? 1.0 : 0.2,
    beforeSend(event) {
      if (event.user) {
        delete event.user.email;
        delete event.user.username;
      }
      return event;
    },
  });
  console.log('[Sentry] Crash reporting initialised, env:', __DEV__ ? 'development' : 'production');
}

export { Sentry };

export function setUserContext(uid: string, venueId: string) {
  Sentry.setUser({ id: uid });
  Sentry.setTag('venueId', venueId);
}

export function clearUserContext() {
  Sentry.setUser(null);
}

export function captureError(error: any, contextOrExtras?: string | Record<string, any>) {
  const context = typeof contextOrExtras === 'string' ? contextOrExtras : undefined;
  const extras = typeof contextOrExtras === 'object' && contextOrExtras !== null ? contextOrExtras : undefined;
  console.error('[Error]', context ?? (extras ? JSON.stringify(extras) : ''), error);
  Sentry.captureException(
    typeof error === 'string' ? new Error(error) : error,
    { tags: { context: context || 'unknown' }, extra: extras },
  );
}

export function captureMessage(message: string, level: 'info' | 'warning' | 'error' = 'info') {
  Sentry.captureMessage(message, level);
}
