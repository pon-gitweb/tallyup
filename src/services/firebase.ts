import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { initializeAuth, getAuth, getReactNativePersistence } from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';

// --- TallyUp Firebase Config (provided by you) ---
const firebaseConfig = {
  apiKey: "AIzaSyCvDiUSXBCCP6LnBTP6nDkWzQIpj5vUGIM",
  authDomain: "tallyup-f1463.firebaseapp.com",
  projectId: "tallyup-f1463",
  storageBucket: "tallyup-f1463.firebasestorage.app",
  messagingSenderId: "596901666549",
  appId: "1:596901666549:web:cadce20353a7b69665efbc"
};

let app: FirebaseApp;
if (!getApps().length) {
  app = initializeApp(firebaseConfig);
  console.log('[TallyUp Firebase] Initialized: tallyup-f1463');
} else {
  app = getApps()[0]!;
}

// React Native Auth persistence
let _auth = getAuth(app);
try {
  // If auth not initialized with RN persistence yet, re-init it:
  // NOTE: calling initializeAuth twice throws — so we guard with a flag on _auth.
  // Expo bundlers sometimes return a stubbed instance; this ensures RN persistence.
  // @ts-ignore custom marker
  if (!_auth._rnPersistence) {
    _auth = initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage),
    }) as unknown as typeof _auth;
    // @ts-ignore marker
    _auth._rnPersistence = true;
  }
} catch (e) {
  // If initializeAuth throws because it's already initialized, keep the existing one.
}

export const auth = _auth;
export const db = getFirestore(app);
