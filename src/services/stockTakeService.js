import { db } from './firebase';
import {
  doc, getDoc, setDoc, updateDoc, serverTimestamp,
  collection, getDocs, addDoc
} from 'firebase/firestore';
import { DEFAULT_DEPARTMENTS } from '../constants/seed';

/** Where we store the active session pointer */
function activePointerRef(venueId) {
  return doc(db, 'venues', venueId, 'meta', 'activeStockTake');
}

function stockTakeRef(venueId, stockTakeId) {
  return doc(db, 'venues', venueId, 'stockTakes', stockTakeId);
}
function deptsColRef(venueId, stockTakeId) {
  return collection(db, 'venues', venueId, 'stockTakes', stockTakeId, 'departments');
}
function deptRef(venueId, stockTakeId, deptId) {
  return doc(db, 'venues', venueId, 'stockTakes', stockTakeId, 'departments', deptId);
}
function areasColRef(venueId, stockTakeId, deptId) {
  return collection(db, 'venues', venueId, 'stockTakes', stockTakeId, 'departments', deptId, 'areas');
}
function areaRef(venueId, stockTakeId, deptId, areaId) {
  return doc(db, 'venues', venueId, 'stockTakes', stockTakeId, 'departments', deptId, 'areas', areaId);
}
function itemsColRef(venueId, stockTakeId, deptId, areaId) {
  return collection(db, 'venues', venueId, 'stockTakes', stockTakeId, 'departments', deptId, 'areas', areaId, 'items');
}

/** Seed sample items ONLY when an area has none (for demo/testing) */
const SAMPLE_ITEMS = [
  { name: 'Beer (Bottle)', expectedQty: 24 },
  { name: 'House Wine (Bottle)', expectedQty: 12 },
  { name: 'Soda Can', expectedQty: 36 },
];

export async function getActiveStockTakeId(venueId) {
  const ptr = await getDoc(activePointerRef(venueId));
  if (!ptr.exists()) return null;
  const data = ptr.data();
  return data?.stockTakeId ?? null;
}

export async function getOrStartActiveStockTake(venueId) {
  // 1) If there's an in-progress stock take, return it
  const existing = await getActiveStockTakeId(venueId);
  if (existing) return existing;

  // 2) Create a new stock take doc
  const stCol = collection(db, 'venues', venueId, 'stockTakes');
  const stDoc = await addDoc(stCol, {
    status: 'in_progress',
    startedAt: serverTimestamp(),
    completedAt: null,
    version: 1,
  });
  const stockTakeId = stDoc.id;

  // 3) Write active pointer
  await setDoc(activePointerRef(venueId), {
    stockTakeId,
    status: 'in_progress',
    updatedAt: serverTimestamp(),
  });

  // 4) Ensure departments/areas exist for this session
  await ensureDepartmentsAndAreas(venueId, stockTakeId);

  return stockTakeId;
}

export async function ensureDepartmentsAndAreas(venueId, stockTakeId) {
  // For each default dept/area, ensure a doc exists for this session
  for (const dept of DEFAULT_DEPARTMENTS) {
    const dRef = deptRef(venueId, stockTakeId, dept.key);
    const dSnap = await getDoc(dRef);
    if (!dSnap.exists()) {
      await setDoc(dRef, {
        key: dept.key,
        name: dept.name,
        createdAt: serverTimestamp(),
      });
    }
    // Ensure areas
    for (const areaName of dept.areas) {
      const aId = areaName.toLowerCase().replace(/\s+/g, '-');
      const aRef = areaRef(venueId, stockTakeId, dept.key, aId);
      const aSnap = await getDoc(aRef);
      if (!aSnap.exists()) {
        await setDoc(aRef, {
          name: areaName,
          status: 'not_started', // not_started | in_progress | completed
          createdAt: serverTimestamp(),
          startedAt: null,
          completedAt: null,
        });
      }
    }
  }
}

/** List departments for the session */
export async function listDepartments(venueId, stockTakeId) {
  const snap = await getDocs(deptsColRef(venueId, stockTakeId));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/** List areas for a department */
export async function listAreas(venueId, stockTakeId, deptId) {
  const snap = await getDocs(areasColRef(venueId, stockTakeId, deptId));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/** Ensure items seeded for an area (once) */
export async function ensureItemsSeeded(venueId, stockTakeId, deptId, areaId) {
  const itemsSnap = await getDocs(itemsColRef(venueId, stockTakeId, deptId, areaId));
  if (itemsSnap.empty) {
    for (const it of SAMPLE_ITEMS) {
      await addDoc(itemsColRef(venueId, stockTakeId, deptId, areaId), {
        name: it.name,
        expectedQty: it.expectedQty,
        count: null,
        createdAt: serverTimestamp(),
      });
    }
  }
}

/** Fetch items for an area */
export async function listItems(venueId, stockTakeId, deptId, areaId) {
  const snap = await getDocs(itemsColRef(venueId, stockTakeId, deptId, areaId));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/** Mark area started when the user begins entering counts (or on first open) */
export async function markAreaStarted(venueId, stockTakeId, deptId, areaId) {
  await updateDoc(areaRef(venueId, stockTakeId, deptId, areaId), {
    status: 'in_progress',
    startedAt: serverTimestamp(),
  });
}

/** Mark area completed */
export async function markAreaCompleted(venueId, stockTakeId, deptId, areaId) {
  await updateDoc(areaRef(venueId, stockTakeId, deptId, areaId), {
    status: 'completed',
    completedAt: serverTimestamp(),
  });
  await updateDoc(activePointerRef(venueId), {
    status: 'in_progress',
    updatedAt: serverTimestamp(),
  });
  await checkAndFinalizeIfComplete(venueId, stockTakeId);
}

/** Check all areas across all departments; if all completed → finalize session */
export async function checkAndFinalizeIfComplete(venueId, stockTakeId) {
  const depts = await listDepartments(venueId, stockTakeId);
  if (depts.length === 0) return;

  for (const d of depts) {
    const areas = await listAreas(venueId, stockTakeId, d.id);
    const anyNotCompleted = areas.some(a => a.status !== 'completed');
    if (anyNotCompleted) return; // still work to do
  }

  // All done → finalize
  await updateDoc(stockTakeRef(venueId, stockTakeId), {
    status: 'completed',
    completedAt: serverTimestamp(),
  });
  // Clear active pointer
  await setDoc(activePointerRef(venueId), {
    stockTakeId: null,
    status: 'idle',
    updatedAt: serverTimestamp(),
  });
}

export async function getDashboardButtonState(venueId) {
  const ptr = await getDoc(activePointerRef(venueId));
  const active = ptr.exists() ? ptr.data() : null;
  if (active?.status === 'in_progress' && active?.stockTakeId) {
    return { label: 'Return to Active Stock Take', stockTakeId: active.stockTakeId };
  }
  return { label: 'Start Stock Take', stockTakeId: null };
}
