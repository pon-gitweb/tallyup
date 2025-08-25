import { db } from './firebase';
import {
  collection, addDoc, updateDoc, deleteDoc, doc, getDocs, serverTimestamp,
} from 'firebase/firestore';

export type Product = {
  id?: string;
  name: string;
  sku?: string;
  unit?: string;            // e.g., 'bottle', 'kg', 'each'
  parLevel?: number;        // target on-hand
  defaultSupplierId?: string|null;
  packSize?: number|null;   // e.g., 24, 6, etc.
  cost?: number|null;       // unit or case cost (decide later)
  updatedAt?: any;
  createdAt?: any;
};

export async function listProducts(venueId: string): Promise<Product[]> {
  const snap = await getDocs(collection(db, 'venues', venueId, 'products'));
  const out: Product[] = [];
  snap.forEach(d => out.push({ id: d.id, ...(d.data() as any) }));
  return out;
}

export async function createProduct(venueId: string, p: Product): Promise<string> {
  const ref = await addDoc(collection(db, 'venues', venueId, 'products'), {
    name: p.name,
    sku: p.sku?.trim() || null,
    unit: p.unit?.trim() || null,
    parLevel: typeof p.parLevel === 'number' ? p.parLevel : null,
    defaultSupplierId: p.defaultSupplierId || null,
    packSize: p.packSize ?? null,
    cost: p.cost ?? null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateProduct(venueId: string, id: string, p: Partial<Product>) {
  const ref = doc(db, 'venues', venueId, 'products', id);
  await updateDoc(ref, {
    ...(p.sku !== undefined ? { sku: p.sku?.trim() || null } : {}),
    ...(p.unit !== undefined ? { unit: p.unit?.trim() || null } : {}),
    ...(p.name !== undefined ? { name: p.name } : {}),
    ...(p.parLevel !== undefined ? { parLevel: p.parLevel } : {}),
    ...(p.defaultSupplierId !== undefined ? { defaultSupplierId: p.defaultSupplierId || null } : {}),
    ...(p.packSize !== undefined ? { packSize: p.packSize } : {}),
    ...(p.cost !== undefined ? { cost: p.cost } : {}),
    updatedAt: serverTimestamp(),
  } as any);
}

export async function deleteProductById(venueId: string, id: string) {
  const ref = doc(db, 'venues', venueId, 'products', id);
  await deleteDoc(ref);
}
