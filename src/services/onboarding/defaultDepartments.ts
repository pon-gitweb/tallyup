/**
 * Default department + area structure for new venues.
 *
 * Safe to call multiple times: it only seeds when the venue has no departments.
 */

import {
  collection,
  doc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';

export type DefaultArea = {
  name: string;
  order: number;
};

export type DefaultDepartment = {
  id: string;
  name: string;
  order: number;
  areas: DefaultArea[];
};

// You can tweak names and ordering here without touching screen code.
export const DEFAULT_DEPARTMENTS: DefaultDepartment[] = [
  {
    id: 'bar',
    name: 'Bar',
    order: 1,
    areas: [
      { name: 'Front Bar', order: 1 },
      { name: 'Back Bar', order: 2 },
      { name: 'Bottle Chiller', order: 3 },
      { name: 'Beer Tap Bay', order: 4 },
    ],
  },
  {
    id: 'kitchen',
    name: 'Kitchen',
    order: 2,
    areas: [
      { name: 'Dry Store', order: 1 },
      { name: 'Walk-in Chiller', order: 2 },
      { name: 'Freezer', order: 3 },
      { name: 'Prep Bench', order: 4 },
    ],
  },
  {
    id: 'bottleshop',
    name: 'Bottle Store',
    order: 3,
    areas: [
      { name: 'Wine Rack', order: 1 },
      { name: 'Spirits Wall', order: 2 },
      { name: 'Beer Fridge', order: 3 },
    ],
  },
  {
    id: 'lounge',
    name: 'Lounge / Restaurant',
    order: 4,
    areas: [
      { name: 'Service Bar', order: 1 },
      { name: 'Floor Fridge', order: 2 },
      { name: 'Feature Shelf', order: 3 },
    ],
  },
];

/**
 * Seed default departments + areas for a venue.
 *
 * - Only runs if there are *no* existing departments.
 * - Writes:
 *   venues/{venueId}/departments/{deptId}
 *   venues/{venueId}/departments/{deptId}/areas/{autoId}
 */
export async function seedDefaultDepartmentsAndAreas(
  venueId: string,
): Promise<{ created: number }> {
  if (!venueId) {
    throw new Error('seedDefaultDepartmentsAndAreas: missing venueId');
  }

  const deptCol = collection(db, 'venues', venueId, 'departments');

  // If there is already at least one department, do nothing.
  const existingSnap = await getDocs(query(deptCol, limit(1)));
  if (!existingSnap.empty) {
    return { created: 0 };
  }

  const batch = writeBatch(db);
  const now = serverTimestamp();
  let created = 0;

  for (const dept of DEFAULT_DEPARTMENTS) {
    const deptRef = doc(deptCol, dept.id);
    batch.set(deptRef, {
      name: dept.name,
      order: dept.order,
      createdAt: now,
      updatedAt: now,
      // You can add more metadata here later (e.g. createdBy: 'system')
    });

    const areasCol = collection(deptRef, 'areas');
    for (const area of dept.areas) {
      const areaRef = doc(areasCol); // auto-id
      batch.set(areaRef, {
        name: area.name,
        order: area.order,
        createdAt: now,
        updatedAt: now,
        startedAt: null,
        completedAt: null,
        // Locking defaults so AreaSelection + AreaInventory are happy:
        lockedByUid: null,
        lockedByName: null,
        lockedAt: null,
        currentLock: null,
      });
      created += 1;
    }
  }

  await batch.commit();
  return { created };
}
