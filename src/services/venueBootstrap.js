import { db } from './firebase';
import {
  doc, getDoc, setDoc, serverTimestamp, collection, addDoc, getDocs, writeBatch
} from 'firebase/firestore';
import 'react-native-get-random-values';
import { v4 as uuid } from 'uuid';
import { DEFAULT_DEPARTMENTS } from '../constants/seed';

/**
 * Ensures a venue has the default departments & areas if currently empty.
 */
export async function ensureSeededForVenue(venueId) {
  const deptsCol = collection(db, 'venues', venueId, 'departments');
  const snap = await getDocs(deptsCol);
  if (!snap.empty) return false; // already seeded

  const batch = writeBatch(db);
  for (const d of DEFAULT_DEPARTMENTS) {
    const depDoc = doc(deptsCol); // pre-generate id
    batch.set(depDoc, {
      key: d.key,
      name: d.name,
      createdAt: serverTimestamp(),
      version: 1,
    });
    for (const areaName of d.areas) {
      const areaDoc = doc(collection(db, 'venues', venueId, 'departments', depDoc.id, 'areas'));
      batch.set(areaDoc, {
        name: areaName,
        isDefault: true,
        status: 'active',
        createdAt: serverTimestamp(),
      });
    }
  }
  await batch.commit();
  return true;
}

/**
 * Creates base docs the first time a user signs in
 * and guarantees the venue is seeded with defaults.
 */
export async function bootstrapIfNeeded(user) {
  if (!user) return;

  console.log('[bootstrapIfNeeded] START', user.uid);

  // 1) user profile
  const userRef = doc(db, 'users', user.uid);
  const userSnap = await getDoc(userRef);
  if (!userSnap.exists()) {
    await setDoc(userRef, {
      email: user.email ?? '',
      displayName: user.displayName ?? '',
      createdAt: serverTimestamp(),
      lastLoginAt: serverTimestamp(),
    });
  } else {
    await setDoc(userRef, { lastLoginAt: serverTimestamp() }, { merge: true });
  }

  // 2) venue
  const existingVenueId = userSnap.exists() ? userSnap.data().venueId : null;
  if (existingVenueId) {
    console.log('[bootstrapIfNeeded] existingVenueId =', existingVenueId);
    // Auto-heal: seed if empty
    await ensureSeededForVenue(existingVenueId);
    return existingVenueId;
  }

  // 3) create solo venue + seed structure
  const venueId = uuid();
  const venueRef = doc(db, 'venues', venueId);
  await setDoc(venueRef, {
    name: 'My Venue',
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    region: 'NZ',
    departments: DEFAULT_DEPARTMENTS.map(d => d.key),
  });

  // role for owner
  const roleRef = doc(db, 'venues', venueId, 'roles', user.uid);
  await setDoc(roleRef, {
    role: 'VENUE_ADMIN',
    departments: DEFAULT_DEPARTMENTS.map(d => d.key),
    grantedAt: serverTimestamp(),
  });

  // seed defaults
  await ensureSeededForVenue(venueId);

  // back-reference venue on user profile
  await setDoc(userRef, { venueId }, { merge: true });
  console.log('[bootstrapIfNeeded] DONE venueId =', venueId);
  return venueId;
}
