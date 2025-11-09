import { doc, getDoc, serverTimestamp, updateDoc, getFirestore } from 'firebase/firestore';

type ConfirmPayload = {
  name: string;
  yield: number | null;
  unit: string | null;
  cogs: number | null;
  rrp: number | null;
  method: string | null;
  gpPct?: number | null;
  rrpIncludesGst?: boolean;
};

export async function confirmRecipe(
  venueId: string,
  recipeId: string,
  payload: ConfirmPayload
) {
  const db = getFirestore();
  const ref = doc(db, 'venues', venueId, 'recipes', recipeId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Draft not found');

  const data = snap.data() || {};
  const items: any[] = Array.isArray(data.items) ? data.items : [];
  if (!payload.name?.trim()) throw new Error('Recipe name required');
  if (!items.length) throw new Error('Add at least one ingredient before confirming');

  const frozenItems = items.map((it) => {
    const toNum = (v: any) => (typeof v === 'number' && Number.isFinite(v)) ? v : (typeof v === 'string' ? Number(v) : null);
    return {
      lineId: it?.lineId || String(Math.random()).slice(2),
      type: it?.type === 'misc' ? 'misc' : 'product',
      name: String(it?.name || ''),
      productId: it?.productId || null,
      packSize: toNum(it?.packSize) ?? null,
      packUnit: it?.packUnit || null,
      packPrice: toNum(it?.packPrice) ?? null,
      unitCost: toNum(it?.unitCost) ?? null,
      qty: toNum(it?.qty) ?? null,
      unit: it?.unit || null,
      cost: toNum(it?.cost) ?? null,
    };
  });

  const safe = (n: any) => (typeof n === 'number' && Number.isFinite(n)) ? n : null;

  await updateDoc(ref, {
    name: payload.name.trim(),
    yield: payload.yield ?? null,
    unit: payload.unit ?? null,
    cogs: safe(payload.cogs),
    rrp: safe(payload.rrp),
    gpPct: safe(payload.gpPct),
    rrpIncludesGst: !!payload.rrpIncludesGst,
    items: frozenItems,
    status: 'confirmed',
    confirmedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return { id: recipeId };
}
