import { initializeApp, getApps } from 'firebase/app';
import { getAuth, initializeAuth, getReactNativePersistence } from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { initializeFirestore, persistentLocalCache, getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FB_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FB_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FB_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FB_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FB_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FB_APP_ID,
};

// Firebase App singleton
export const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

let authInstance: any;
try {
  authInstance = initializeAuth(app, {
    persistence: getReactNativePersistence(AsyncStorage),
  });
} catch {
  authInstance = getAuth(app);
}

export const auth = authInstance;
// Enable offline persistence — all Firestore reads/writes work offline
// Data syncs automatically when connection is restored
export const db = (() => {
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache(),
    });
  } catch {
    // Already initialised (hot reload) — return existing instance
    return getFirestore(app);
  }
})();
export const storage = getStorage(app);


if (__DEV__) {
  try {
    console.log(
      '[TallyUp Firebase] Initialized:',
      app?.options?.projectId || '(unknown)',
      '| key:', String(firebaseConfig.apiKey || '').slice(0, 8) + '…'
    );
  } catch {}
}
