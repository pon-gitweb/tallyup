import 'react-native-get-random-values';
import { v4 as uuid } from 'uuid';
import { db } from './firebase';
import {
  doc, getDoc, setDoc, serverTimestamp, collection, addDoc
} from 'firebase/firestore';
import { DEFAULT_DEPARTMENTS } from '../constants/seed';

/**
 * Creates base docs the first time a user signs in:
 * - users/{uid}
 * - venues/{venueId}
 * - venues/{venueId}/roles/{uid}
 * - venues/{venueId}/departments/* + areas
 */
export async function bootstrapIfNeeded(user) {
  console.log('[bootstrapIfNeeded] START', user?.uid);
  if (!user) return;

  // 1) user profile
  console.log('[bootstrapIfNeeded] Checking user profile...');
  const userRef = doc(db, 'users', user.uid);
  const userSnap = await getDoc(userRef);
  console.log('[bootstrapIfNeeded] User doc exists?', userSnap.exists());
  if (!userSnap.exists()) {
    await setDoc(userRef, {
      email: user.email ?? '',
      displayName: user.displayName ?? '',
      createdAt: serverTimestamp(),
      lastLoginAt: serverTimestamp(),
    });
  } else {
    console.log('[bootstrapIfNeeded] Updating lastLoginAt...');
    await setDoc(userRef, { lastLoginAt: serverTimestamp() }, { merge: true });
  }

  // 2) check if user already has a venue role
  const existingVenueId = userSnap.exists() ? userSnap.data().venueId : null;
  console.log('[bootstrapIfNeeded] existingVenueId =', existingVenueId);
  if (existingVenueId) return existingVenueId;

  // 3) create solo venue + seed structure
  console.log('[bootstrapIfNeeded] Creating new venue...');
  const venueId = uuid();
  const venueRef = doc(db, 'venues', venueId);
  await setDoc(venueRef, {
    name: 'My Venue',
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    region: 'NZ',
    departments: DEFAULT_DEPARTMENTS.map(d => d.key),
  });

  // role: Venue Admin for this owner
  const roleRef = doc(db, 'venues', venueId, 'roles', user.uid);
  await setDoc(roleRef, {
    role: 'VENUE_ADMIN',
    departments: DEFAULT_DEPARTMENTS.map(d => d.key),
    grantedAt: serverTimestamp(),
  });

  // departments + areas
  for (const d of DEFAULT_DEPARTMENTS) {
    const deptRef = await addDoc(collection(db, 'venues', venueId, 'departments'), {
      key: d.key,
      name: d.name,
      createdAt: serverTimestamp(),
      version: 1,
    });
    for (const areaName of d.areas) {
      await addDoc(collection(db, 'venues', venueId, 'departments', deptRef.id, 'areas'), {
        name: areaName,
        isDefault: true,
        status: 'active',
        createdAt: serverTimestamp(),
      });
    }
  }

  // back-reference venue on user profile
  await setDoc(userRef, { venueId }, { merge: true });
  console.log('[bootstrapIfNeeded] DONE venueId =', venueId);
  return venueId;
}
