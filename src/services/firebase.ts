// Firebase initializer for TallyUp (single source of truth)
import { initializeApp, getApps, getApp, FirebaseApp } from "firebase/app";
import {
  initializeAuth,
  getAuth,
  getReactNativePersistence,
  Auth,
} from "firebase/auth";
import {
  getFirestore,
  initializeFirestore,
  Firestore,
  memoryLocalCache,
} from "firebase/firestore";
import { getStorage, FirebaseStorage } from "firebase/storage";
import AsyncStorage from "@react-native-async-storage/async-storage";

// --- TallyUp Firebase config ---
const firebaseConfig = {
  apiKey: "AIzaSyCvDiUSXBCCP6LnBTP6nDkWzQIpj5vUGIM",
  authDomain: "tallyup-f1463.firebaseapp.com",
  projectId: "tallyup-f1463",
  storageBucket: "tallyup-f1463.firebasestorage.app",
  messagingSenderId: "596901666549",
  appId: "1:596901666549:web:cadce20353a7b69665efbc",
};

let app: FirebaseApp;
let db: Firestore;
let auth: Auth;
let storage: FirebaseStorage;

if (!getApps().length) {
  app = initializeApp(firebaseConfig);

  // Firestore: RN/Hermes friendly
  db = initializeFirestore(app, {
    localCache: memoryLocalCache(),
    experimentalForceLongPolling: true,
    useFetchStreams: false,
  });

  // Auth: persist across app restarts using AsyncStorage
  auth = initializeAuth(app, {
    persistence: getReactNativePersistence(AsyncStorage),
  });

  console.log("[TallyUp Firebase] Initialized:", firebaseConfig.projectId);
} else {
  app = getApp();
  db = getFirestore(app);
  auth = getAuth(app);
}

storage = getStorage(app);

export { app, db, auth, storage };
