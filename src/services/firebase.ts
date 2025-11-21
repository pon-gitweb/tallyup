// src/services/firebase.ts
// React Native Firebase bootstrap for TallyUp (tallyup-f1463)

import { initializeApp, getApps } from 'firebase/app';
import {
  getAuth,
  initializeAuth,
  getReactNativePersistence,
} from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

// This is the web config from your Firebase console for TallyUp
// (project: tallyup-f1463).
const firebaseConfig = {
  apiKey: 'AIzaSyCvDiUSXBCCP6LnBTP6nDkWzQIpj5vUGIM',
  authDomain: 'tallyup-f1463.firebaseapp.com',
  projectId: 'tallyup-f1463',
  storageBucket: 'tallyup-f1463.firebasestorage.app',
  messagingSenderId: '596901666549',
  appId: '1:596901666549:web:cadce20353a7b69665efbc',
  // measurementId optional, and not needed in RN
};

// Create (or reuse) the app
export const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

// On React Native we should use initializeAuth with AsyncStorage persistence,
// but fall back safely if it’s already initialised by another module.
let authInstance;
try {
  authInstance = initializeAuth(app, {
    persistence: getReactNativePersistence(AsyncStorage),
  });
} catch (e) {
  // If initializeAuth was already called somewhere else, just use getAuth.
  authInstance = getAuth(app);
}

export const auth = authInstance;
export const db = getFirestore(app);
export const storage = getStorage(app);

// Debug: confirm which project + key we are bound to
if (__DEV__) {
  try {
    // @ts-ignore
    const opts = app.options || {};
    console.log(
      '[TallyUp Firebase] Initialized:',
      opts.projectId,
      '| key:',
      (opts.apiKey || '').slice(0, 8) + '…'
    );
  } catch {}
}
