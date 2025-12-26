import { initializeApp, getApps } from 'firebase/app';
import { getAuth, initializeAuth } from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: 'AIzaSyAOeU2M8xTOnU3oP9H-0Rj',
  authDomain: 'tallyup-dev.firebaseapp.com',
  projectId: 'tallyup-dev',
  storageBucket: 'tallyup-dev.appspot.com',
  messagingSenderId: '1234567890',
  appId: '1:1234567890:web:abcdef123456',
};

// Firebase App singleton
export const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

/**
 * Auth:
 * - RN runtime wants initializeAuth + AsyncStorage persistence.
 * - Jest/node environment may not have getReactNativePersistence() available depending on firebase/auth build.
 *   In that case, fall back to getAuth(app) so unit tests can import modules that touch firebase.ts.
 */
let authInstance: any;

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const authMod = require('firebase/auth');
  const getReactNativePersistence = authMod?.getReactNativePersistence;

  if (typeof getReactNativePersistence === 'function') {
    authInstance = initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  } else {
    authInstance = getAuth(app);
  }
} catch {
  authInstance = getAuth(app);
}

export const auth = authInstance;

// Firestore / Storage
export const db = getFirestore(app);
export const storage = getStorage(app);

// Debug: confirm which project we’re bound to
if (__DEV__) {
  try {
    // @ts-ignore – options is present on app
    console.log(
      '[TallyUp Firebase] Initialized:',
      app?.options?.projectId || '(unknown)',
      '| key:',
      String(firebaseConfig.apiKey || '').slice(0, 8) + '…'
    );
  } catch {}
}
