import { getFirestore, doc, getDoc, collection, addDoc, serverTimestamp } from 'firebase/firestore';

export async function duplicateRecipe(
  venueId: string,
  sourceRecipeId: string
): Promise<{ id: string }> {
  const db = getFirestore();
  const srcRef = doc(db, 'venues', venueId, 'recipes', sourceRecipeId);
  const srcSnap = await getDoc(srcRef);
  if (!srcSnap.exists()) throw new Error('Source recipe not found');

  const src = srcSnap.data() || {};
  if ((src.status ?? 'draft') !== 'confirmed') {
    throw new Error('Only confirmed recipes can be duplicated');
  }

  // Create a new draft with a "(copy)" suffix; freeze the current snapshot into the draft as editable items
  const name = String(src.name || '(copy)') + ' (copy)';
  const items = Array.isArray(src.items) ? JSON.parse(JSON.stringify(src.items)) : [];

  const dstRef = await addDoc(collection(db, 'venues', venueId, 'recipes'), {
    name,
    nameLower: name.toLowerCase(),
    status: 'draft',
    category: src.category ?? null,
    mode: src.mode ?? null,
    yield: src.yield ?? null,
    unit: src.unit ?? null,
    items,
    cogs: src.cogs ?? null,
    rrp: src.rrp ?? null,
    method: src.method ?? null,
    gpPct: src.gpPct ?? null,
    rrpIncludesGst: !!src.rrpIncludesGst,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return { id: dstRef.id };
}
