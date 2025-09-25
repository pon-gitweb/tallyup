import { initializeApp } from 'firebase/app';
import {
  getReactNativePersistence,
  initializeAuth
} from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyCvDiUSXBCCP6LnBTP6nDkWzQIpj5vUGIM",
  authDomain: "tallyup-f1463.firebaseapp.com",
  projectId: "tallyup-f1463",
  storageBucket: "tallyup-f1463.firebasestorage.app",
  messagingSenderId: "596901666549",
  appId: "1:596901666549:web:cadce20353a7b69665efbc"
};

const app = initializeApp(firebaseConfig);

// IMPORTANT: initializeAuth BEFORE any getAuth usage
export const auth = initializeAuth(app, {
  persistence: getReactNativePersistence(AsyncStorage),
});

export const db = getFirestore(app);

console.log('[TallyUp Firebase] Initialized: tallyup-f1463');
