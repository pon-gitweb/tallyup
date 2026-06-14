// Push notification service.
// REQUIRES: npx expo install expo-notifications
// (expo-notifications is not yet in package.json — install before building)

import { getFirestore, doc, updateDoc, arrayUnion } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

// Lazy-load expo-notifications so the app doesn't crash if the package
// isn't installed yet. Remove the try/catch once the package is installed.
let Notifications: typeof import('expo-notifications') | null = null;
try {
  Notifications = require('expo-notifications');
} catch {
  console.warn('[Notifications] expo-notifications not installed. Run: npx expo install expo-notifications');
}

// ─── Foreground notification display ────────────────────────────────────────

if (Notifications) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

// ─── Register device for push notifications ──────────────────────────────────
// Call once after the user signs in and the venue loads.
// Stores the Expo push token against users/{uid}.fcmTokens in Firestore.

export async function registerForPushNotifications(): Promise<void> {
  if (!Notifications) {
    console.warn('[Notifications] expo-notifications not installed — skipping registration.');
    return;
  }
  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.log('[Notifications] permission denied');
      return;
    }

    const token = await Notifications.getExpoPushTokenAsync({
      projectId: 'f51fbba0-356b-46ef-9ef5-2017ee9ad59f',
    });

    const uid = getAuth().currentUser?.uid;
    if (!uid) return;

    const db = getFirestore();
    await updateDoc(doc(db, 'users', uid), {
      fcmTokens: arrayUnion(token.data),
      fcmTokenUpdatedAt: new Date(),
    });

    console.log('[Notifications] token registered:', token.data.slice(0, 20) + '…');
  } catch (error) {
    console.error('[Notifications] registration failed:', error);
  }
}

// ─── Handle tap on a notification (deep-link to correct screen) ─────────────

export function setupNotificationResponseHandler(navigation: any): () => void {
  if (!Notifications) return () => {};

  const subscription = Notifications.addNotificationResponseReceivedListener(response => {
    const data = response.notification.request.content.data as any;
    if (data?.screen) {
      navigation.navigate(data.screen, {
        highlightBarId: data.barId,
        highlightProductId: data.productId,
      });
    }
  });

  return () => subscription.remove();
}

// ─── Handle notification received while app is in foreground ────────────────

export function setupForegroundHandler(): () => void {
  if (!Notifications) return () => {};

  const subscription = Notifications.addNotificationReceivedListener(notification => {
    // setNotificationHandler above handles display — just log here
    console.log(
      '[Notifications] received in foreground:',
      notification.request.content.title,
    );
  });

  return () => subscription.remove();
}
