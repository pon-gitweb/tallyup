import { collection, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { db } from '../services/firebase';

export type AuditEntry = {
  id: string;
  type: string;
  createdAt?: any;
  itemId?: string;
  itemName?: string|null;
  fromQty?: number|null;
  toQty?: number|null;
  requestId?: string;
  decidedBy?: string|null;
  decisionNote?: string|null;
};

export async function fetchRecentItemAudits(venueId: string, itemId: string, take = 20): Promise<AuditEntry[]> {
  const q = query(
    collection(db, 'venues', venueId, 'audits'),
    where('itemId', '==', itemId),
    orderBy('createdAt', 'desc'),
    limit(take)
  );
  const snap = await getDocs(q);
  const out: AuditEntry[] = [];
  snap.forEach(d => out.push({ id: d.id, ...(d.data() as any) }));
  return out;
}
