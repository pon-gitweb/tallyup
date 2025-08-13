import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { initializeAuth, getReactNativePersistence, Auth } from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';

const firebaseConfig = {
  apiKey: "AIzaSyCvDiUSXBCCP6LnBTP6nDkWzQIpj5vUGIM",
  authDomain: "tallyup-f1463.firebaseapp.com",
  projectId: "tallyup-f1463",
  storageBucket: "tallyup-f1463.appspot.com",
  messagingSenderId: "596901666549",
};

export const app: FirebaseApp = getApps().length ? getApps()[0]! : initializeApp(firebaseConfig);

declare global { var __TALLYUP_AUTH__: Auth | undefined; }
if (!global.__TALLYUP_AUTH__) {
  global.__TALLYUP_AUTH__ = initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) });
}
export const auth = global.__TALLYUP_AUTH__ as Auth;

export const db = getFirestore(app);
export const storage = getStorage(app);
