/**
 * Default supplier seeds for a *venue*.
 *
 * We do NOT write to /global_suppliers here because Firestore rules make that
 * collection read-only from the client. Instead, we seed venue-scoped
 * suppliers under:
 *
 *   venues/{venueId}/suppliers/{autoId}
 *
 * Safe to run multiple times: we store a seedKey and skip existing ones.
 */

import {
  collection,
  getDocs,
  writeBatch,
  doc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';

export type SupplierSeed = {
  id: string;          // stable seed key
  name: string;
  category?: string;   // optional: beverage / food / other
  note?: string | null;
};

export const DEFAULT_SUPPLIERS: SupplierSeed[] = [
  {
    id: 'lion-nz',
    name: 'Lion NZ',
    category: 'beverage',
    note: 'Beer, cider, RTDs and some wine.',
  },
  {
    id: 'db-breweries',
    name: 'DB Breweries',
    category: 'beverage',
    note: 'Beer, cider and RTDs.',
  },
  {
    id: 'cc-ep',
    name: 'Coca-Cola Europacific Partners',
    category: 'beverage',
    note: 'Post-mix, PET, juices and energy drinks.',
  },
  {
    id: 'asahi-nz',
    name: 'Asahi / Independent',
    category: 'beverage',
    note: 'Beer, RTDs and spirits portfolio.',
  },
  {
    id: 'pernod-ricard',
    name: 'Pernod Ricard',
    category: 'beverage',
    note: 'Spirits and wine.',
  },
  {
    id: 'brown-forman',
    name: 'Brown-Forman',
    category: 'beverage',
    note: 'Spirits.',
  },
  {
    id: 'bidfood',
    name: 'Bidfood',
    category: 'food',
    note: 'Broadline foodservice.',
  },
  {
    id: 'service-foods',
    name: 'Service Foods',
    category: 'food',
    note: 'Broadline foodservice.',
  },
  {
    id: 'gilmours',
    name: 'Gilmours',
    category: 'food',
    note: 'Cash & Carry / wholesale.',
  },
  {
    id: 'cg-rouse',
    name: 'C&G Rouse',
    category: 'food',
    note: 'Example regional supplier.',
  },
];

/**
 * Seed default suppliers into a single venue:
 *
 *   venues/{venueId}/suppliers/{autoId}
 *
 * We write a `seedKey` so we can skip duplicates on subsequent runs.
 */
export async function seedDefaultVenueSuppliers(
  venueId: string,
): Promise<{ created: number; skipped: number }> {
  if (!venueId) {
    throw new Error('seedDefaultVenueSuppliers: missing venueId');
  }

  const suppliersCol = collection(db, 'venues', venueId, 'suppliers');

  // Fetch existing seeds once and build a lookup by seedKey
  const existingSnap = await getDocs(suppliersCol);
  const existingSeedKeys = new Set<string>();
  existingSnap.forEach((d) => {
    const data = d.data() as any;
    if (typeof data.seedKey === 'string') {
      existingSeedKeys.add(data.seedKey);
    }
  });

  const batch = writeBatch(db);
  const now = serverTimestamp();
  let created = 0;
  let skipped = 0;

  for (const seed of DEFAULT_SUPPLIERS) {
    if (existingSeedKeys.has(seed.id)) {
      skipped += 1;
      continue;
    }

    const ref = doc(suppliersCol); // auto-id
    batch.set(ref, {
      name: seed.name,
      category: seed.category ?? null,
      note: seed.note ?? null,
      seedKey: seed.id,
      isDefaultSeed: true,
      createdAt: now,
      updatedAt: now,
      active: true,
    });
    created += 1;
  }

  if (created === 0) {
    // Nothing to write; avoid a no-op commit
    return { created: 0, skipped };
  }

  await batch.commit();
  return { created, skipped };
}
