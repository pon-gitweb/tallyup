import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'

// Same Firebase project as the Expo mobile app (tallyup-f1463) — shared
// Firestore database and Auth. These are public client config values (not
// secrets); Firebase Security Rules are the actual access control. Hard-coded
// here deliberately — this is a separate project from the Expo app and does
// not share its .env.
const firebaseConfig = {
  apiKey: 'AIzaSyCvDiUSXBCCP6LnBTP6nDkWzQIpj5vUGIM',
  authDomain: 'tallyup-f1463.firebaseapp.com',
  projectId: 'tallyup-f1463',
  storageBucket: 'tallyup-f1463.appspot.com',
  messagingSenderId: '596901666549',
  appId: '1:596901666549:android:06ce71ac2b55abc065efbc',
}

export const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const db = getFirestore(app)
export const storage = getStorage(app)
