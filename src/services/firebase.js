import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getAuth } from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';

const firebaseConfig = {
  apiKey: "AIzaSyCvDiUSXBCCP6LnBTP6nDkWzQIpj5vUGIM",
  authDomain: "tallyup-f1463.firebaseapp.com",
  projectId: "tallyup-f1463",
  storageBucket: "tallyup-f1463.firebasestorage.app",
  messagingSenderId: "596901666549",
  appId: "1:596901666549:web:cadce20353a7b69665efbc"
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

let auth;
try {
  const { initializeAuth, getReactNativePersistence } = require('firebase/auth/react-native');
  auth = initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) });
} catch {
  auth = getAuth(app);
}

export const db = getFirestore(app);
export const storage = getStorage(app);
export { auth };
