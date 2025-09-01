import { db } from './firebase';
import {
  addDoc, collection, doc, getDoc, getDocs, query, where, orderBy,
  setDoc, updateDoc, serverTimestamp, Timestamp,
} from 'firebase/firestore';

export type Budget = {
  id?: string;
  amount: number;                 // total budget for the period
  supplierId?: string | null;     // optional: per-supplier budget
  periodStart: Timestamp;         // inclusive
  periodEnd: Timestamp;           // inclusive
  notes?: string | null;
  createdAt?: any;
  updatedAt?: any;
};

export type BudgetProgress = {
  budgetId: string;
  amount: number;
  spent: number;
  remaining: number;
  pct: number; // 0..100
};

export function isoToTs(iso: string): Timestamp {
  // Expect "YYYY-MM-DD". We set midnight UTC to avoid tz drift across devices.
  const d = new Date(iso + 'T00:00:00.000Z');
  return Timestamp.fromDate(d);
}

export function tsToIso(ts: Timestamp): string {
  const d = ts.toDate();
  return d.toISOString().slice(0, 10);
}

/** Create a budget. */
export async function createBudget(venueId: string, data: Omit<Budget, 'id'|'createdAt'|'updatedAt'>) {
  if (!venueId) throw new Error('Missing venueId');
  const col = collection(db, 'venues', venueId, 'budgets');
  const docRef = await addDoc(col, {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return { id: docRef.id };
}

/** Update a budget. */
export async function updateBudget(venueId: string, budgetId: string, patch: Partial<Budget>) {
  if (!venueId || !budgetId) throw new Error('Missing ids');
  const ref = doc(db, 'venues', venueId, 'budgets', budgetId);
  await updateDoc(ref, { ...patch, updatedAt: serverTimestamp() });
}

/** List budgets (newest first by periodEnd). */
export async function listBudgets(venueId: string): Promise<Budget[]> {
  if (!venueId) return [];
  const col = collection(db, 'venues', venueId, 'budgets');
  const qy = query(col, orderBy('periodEnd', 'desc'));
  const snap = await getDocs(qy);
  return snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Budget[];
}

/** Get one budget. */
export async function getBudget(venueId: string, budgetId: string): Promise<Budget | null> {
  if (!venueId || !budgetId) return null;
  const ref = doc(db, 'venues', venueId, 'budgets', budgetId);
  const s = await getDoc(ref);
  return s.exists() ? ({ id: s.id, ...(s.data() as any) } as Budget) : null;
}

/** Compute spend for a budget period. Counts orders with status IN ['submitted','received'] using submittedAt within range. */
export async function computeBudgetProgress(venueId: string, budget: Budget): Promise<BudgetProgress> {
  const start = budget.periodStart;
  const end = budget.periodEnd;
  const ordersCol = collection(db, 'venues', venueId, 'orders');

  // Only 'submitted' or 'received' orders, and only those submitted in the window.
  // (We set submittedAt when submitting.)
  const qy = query(
    ordersCol,
    where('status', 'in', ['submitted', 'received']),
    where('submittedAt', '>=', start),
    where('submittedAt', '<=', end),
    orderBy('submittedAt', 'desc'),
  );

  const ordSnap = await getDocs(qy);

  let spent = 0;

  for (const ordDoc of ordSnap.docs) {
    const o = ordDoc.data() as any;
    if (budget.supplierId && o.supplierId !== budget.supplierId) continue;

    // Sum lines: qty * unitCost
    const linesCol = collection(db, 'venues', venueId, 'orders', ordDoc.id, 'lines');
    const linesSnap = await getDocs(linesCol);
    for (const line of linesSnap.docs) {
      const l = line.data() as any;
      const qty = Number(l.qty) || 0;
      const unit = Number(l.unitCost) || 0;
      spent += qty * unit;
    }
  }

  const amount = Number(budget.amount) || 0;
  const remaining = Math.max(0, amount - spent);
  const pct = amount > 0 ? Math.min(100, Math.round((spent / amount) * 100)) : 0;

  return { budgetId: budget.id!, amount, spent, remaining, pct };
}
