// React Native Firebase bootstrap (Expo SDK53+ / Hermes)
// Env-driven to avoid pointing at the wrong project by accident.

import { initializeApp, getApps } from 'firebase/app';
import { initializeAuth, getReactNativePersistence } from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

// Read config from env (Expo only exposes EXPO_PUBLIC_* at runtime)
const firebaseConfig = {
  apiKey:         process.env.EXPO_PUBLIC_FB_API_KEY!,
  authDomain:     process.env.EXPO_PUBLIC_FB_AUTH_DOMAIN!,
  projectId:      process.env.EXPO_PUBLIC_FB_PROJECT_ID!,
  storageBucket:  process.env.EXPO_PUBLIC_FB_STORAGE_BUCKET!,
  messagingSenderId: process.env.EXPO_PUBLIC_FB_MESSAGING_SENDER_ID!,
  appId:          process.env.EXPO_PUBLIC_FB_APP_ID!,
  measurementId:  process.env.EXPO_PUBLIC_FB_MEASUREMENT_ID, // optional
};

// Create (or reuse) app
export const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

// RN requires initializeAuth with AsyncStorage persistence
export const auth = initializeAuth(app, {
  persistence: getReactNativePersistence(AsyncStorage),
});

// Firestore / Storage
export const db = getFirestore(app);
export const storage = getStorage(app);

// Debug: confirm which project we’re bound to
if (__DEV__) {
  try {
    // @ts-ignore – options is present on app
    console.log('[TallyUp Firebase] Initialized:', app?.options?.projectId || '(unknown)');
  } catch {}
}
