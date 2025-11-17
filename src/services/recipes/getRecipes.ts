import {
  getFirestore,
  collection,
  query,
  where,
  orderBy,
  startAt,
  endAt,
  limit,
  getDocs
} from 'firebase/firestore';

export type RecipeStatus = 'draft' | 'confirmed';

export type GetRecipesFilters = {
  venueId: string;
  status?: 'all' | RecipeStatus;
  search?: string; // name prefix search (case-insensitive)
  pageSize?: number; // default 50
};

export type RecipeListRow = {
  id: string;
  name: string;
  status: RecipeStatus;
  category?: 'food' | 'beverage' | null;
  mode?: 'single' | 'batch' | 'dish' | null;
  cogs?: number | null;
  rrp?: number | null;
  updatedAt?: any;
  hasConsumption: boolean;
  hasPosLink: boolean;
};

export async function getRecipes(filters: GetRecipesFilters): Promise<RecipeListRow[]> {
  const db = getFirestore();
  const { venueId, status = 'all', search = '', pageSize = 50 } = filters;

  const col = collection(db, 'venues', venueId, 'recipes');

  const constraints: any[] = [];

  // Status filter
  if (status === 'draft') constraints.push(where('status', '==', 'draft'));
  if (status === 'confirmed') constraints.push(where('status', '==', 'confirmed'));

  // For name search we rely on orderBy('nameLower')
  // Draft/confirm writers should store a nameLower; to be defensive, we still order by 'name'
  // but we try nameLower first.
  // We’ll search prefix by transforming to lower case.
  const searchLower = (search || '').trim().toLowerCase();
  if (searchLower) {
    constraints.push(orderBy('nameLower'));
    constraints.push(startAt(searchLower));
    constraints.push(endAt(searchLower + '\uf8ff'));
  } else {
    constraints.push(orderBy('updatedAt', 'desc'));
  }

  constraints.push(limit(pageSize));

  const q = query(col, ...constraints);
  const snap = await getDocs(q);

  return snap.docs.map(d => {
    const data = d.data() as any;

    const hasConsumption =
      !!data?.consumptionPerServe &&
      typeof data.consumptionPerServe === 'object' &&
      Object.keys(data.consumptionPerServe).length > 0;

    const hasPosLink =
      !!data?.posProductId ||
      (Array.isArray(data?.posProductIds) && data.posProductIds.length > 0);

    return {
      id: d.id,
      name: data?.name ?? '(unnamed)',
      status: (data?.status ?? 'draft') as RecipeStatus,
      category: data?.category ?? null,
      mode: data?.mode ?? null,
      cogs: data?.cogs ?? null,
      rrp: data?.rrp ?? null,
      updatedAt: data?.updatedAt ?? null,
      hasConsumption,
      hasPosLink,
    };
  });
}
