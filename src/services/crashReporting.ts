// @ts-nocheck
/**
 * crashReporting.ts
 * Sentry crash reporting — gives visibility into what's breaking in the field.
 * Replace SENTRY_DSN with your actual DSN from sentry.io
 */
import * as Sentry from '@sentry/react-native';

const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN || '';

export function initCrashReporting() {
  if (!SENTRY_DSN) {
    console.log('[Sentry] No DSN configured — crash reporting disabled');
    return;
  }
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: __DEV__ ? 'development' : 'production',
    tracesSampleRate: 0.2,
    enabled: !__DEV__, // Only report in production
    beforeSend(event) {
      // Strip any sensitive data before sending
      if (event.user) {
        delete event.user.email;
        delete event.user.username;
      }
      return event;
    },
  });
  console.log('[Sentry] Crash reporting initialised');
}

export function setUserContext(uid: string, venueId: string) {
  Sentry.setUser({ id: uid });
  Sentry.setTag('venueId', venueId);
}

export function captureError(error: any, context?: string) {
  if (__DEV__) {
    console.error('[Error]', context || '', error);
    return;
  }
  Sentry.captureException(error, { tags: { context: context || 'unknown' } });
}

export function captureMessage(message: string, level: 'info' | 'warning' | 'error' = 'info') {
  if (__DEV__) {
    console.log('[Message]', message);
    return;
  }
  Sentry.captureMessage(message, level);
}
