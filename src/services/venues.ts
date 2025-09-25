import {
  addDoc, collection, doc, getDoc, setDoc, updateDoc,
  serverTimestamp, writeBatch
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { db } from '../services/firebase';

type SeedDef = { department: string; areas: string[] };

const SEEDS: SeedDef[] = [
  { department: 'Bar',     areas: ['Front Bar', 'Back Bar', 'Fridge', 'Cellar'] },
  { department: 'Kitchen', areas: ['Prep', 'Cookline', 'Freezer', 'Dry Store'] },
];

function logStep(step: string, ctx: Record<string, any> = {}) {
  console.log('[TallyUp CreateVenue]', step, JSON.stringify(ctx));
}

function keysOnly(obj: any) {
  return obj && typeof obj === 'object' ? Object.keys(obj).sort() : [];
}

/**
 * Creates a first venue owned by the current user.
 * ORDER IS CRITICAL (to satisfy security rules):
 *  1) ensure user doc exists AND has venueId (null if new/missing)
 *  2) create venues/{id} with {ownerUid}
 *  3) set venues/{id}/members/{uid} (role: owner)
 *  4) seed departments & areas
 *  5) set sessions/current = {status: 'idle'}
 *  6) update users/{uid}.venueId (first time only)
 */
export async function createVenueOwnedByCurrentUser(name: string): Promise<string> {
  const auth = getAuth();
  const user = auth.currentUser;
  if (!user) {
    const err = new Error('Not signed in');
    (err as any).code = 'auth/not-signed-in';
    throw err;
  }
  const uid = user.uid;
  logStep('begin', { uid, name });

  // 1) Ensure users/{uid} exists AND has venueId field (explicit null if missing)
  const userRef = doc(db, 'users', uid);
  const userSnap = await getDoc(userRef);
  if (!userSnap.exists()) {
    const toWrite = { createdAt: serverTimestamp(), venueId: null };
    logStep('write users/{uid}', { path: userRef.path, keys: keysOnly(toWrite) });
    try {
      await setDoc(userRef, toWrite, { merge: true });
    } catch (e: any) {
      logStep('fail users/{uid}', { path: userRef.path, code: e.code, message: e.message });
      throw e;
    }
  } else {
    const data = userSnap.data() || {};
    const hasVenueIdField = Object.prototype.hasOwnProperty.call(data, 'venueId');
    logStep('users/{uid} exists', { path: userRef.path, dataKeys: keysOnly(data), hasVenueIdField });
    if (!hasVenueIdField) {
      const patch = { venueId: null, touchedAt: serverTimestamp() };
      logStep('patch users/{uid} venueId:null', { path: userRef.path, keys: keysOnly(patch) });
      try {
        await setDoc(userRef, patch, { merge: true });
      } catch (e: any) {
        logStep('fail users/{uid} patch', { path: userRef.path, code: e.code, message: e.message });
        throw e;
      }
    }
  }

  // 2) Create venue doc with ownerUid == uid
  const venuesCol = collection(db, 'venues');
  const venuePayload = {
    name,
    ownerUid: uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  logStep('create venues doc', { col: 'venues', keys: keysOnly(venuePayload) });

  let venueId = '';
  try {
    const venueRef = await addDoc(venuesCol, venuePayload);
    venueId = venueRef.id;
    logStep('venues/{id} created', { venueId });
  } catch (e: any) {
    logStep('fail venues create', { code: e.code, message: e.message, keys: keysOnly(venuePayload) });
    throw e;
  }

  // 3) Set membership doc for owner
  const memberRef = doc(db, 'venues', venueId, 'members', uid);
  const memberPayload = { role: 'owner', createdAt: serverTimestamp() };
  logStep('write members/{uid}', { path: memberRef.path, keys: keysOnly(memberPayload) });
  try {
    await setDoc(memberRef, memberPayload, { merge: true });
  } catch (e: any) {
    logStep('fail members/{uid}', { path: memberRef.path, code: e.code, message: e.message, keys: keysOnly(memberPayload) });
    throw e;
  }

  // 4) Seed departments & areas (batch per department)
  for (const seed of SEEDS) {
    const deptRef = doc(db, 'venues', venueId, 'departments', seed.department);
    const deptPayload = {
      name: seed.department,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    logStep('seed department', { path: deptRef.path, keys: keysOnly(deptPayload) });

    const batch = writeBatch(db);
    batch.set(deptRef, deptPayload, { merge: true });

    for (const area of seed.areas) {
      const areaRef = doc(db, 'venues', venueId, 'departments', seed.department, 'areas', area);
      const areaPayload = {
        name: area,
        startedAt: null,
        completedAt: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      logStep('seed area', { path: areaRef.path, keys: keysOnly(areaPayload) });
      batch.set(areaRef, areaPayload, { merge: true });
    }

    try {
      await batch.commit();
    } catch (e: any) {
      logStep('fail seed department batch', { dept: seed.department, code: e.code, message: e.message });
      throw e;
    }
  }

  // 5) Seed sessions/current = idle
  const sessionRef = doc(db, 'venues', venueId, 'sessions', 'current');
  const sessionPayload = { status: 'idle', createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
  logStep('write sessions/current', { path: sessionRef.path, keys: keysOnly(sessionPayload) });
  try {
    await setDoc(sessionRef, sessionPayload, { merge: true });
  } catch (e: any) {
    logStep('fail sessions/current', { path: sessionRef.path, code: e.code, message: e.message });
    throw e;
  }

  // 6) Update users/{uid}.venueId (first time only—rules enforce immutability after set)
  const venueIdUpdate = { venueId };
  logStep('update users/{uid}.venueId', { path: userRef.path, keys: keysOnly(venueIdUpdate) });
  try {
    await updateDoc(userRef, venueIdUpdate as any);
  } catch (e: any) {
    logStep('fail users/{uid}.venueId', { path: userRef.path, code: e.code, message: e.message });
    throw e;
  }

  logStep('success', { venueId });
  return venueId;
}
