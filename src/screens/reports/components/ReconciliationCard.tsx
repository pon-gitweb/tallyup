// @ts-nocheck
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, FlatList } from 'react-native';
import { getFirestore, collection, getDocs, query, orderBy, limit } from 'firebase/firestore';
import { useVenueId } from '../../../context/VenueProvider';

type Props = {
  venueId?: string; // optional (will use context if not provided)
  onOpenOrder?: (orderId: string) => void;
  maxSuppliers?: number; // optional cap
  maxPerSupplier?: number; // optional cap per supplier
};

type RecDoc = {
  id: string;
  orderId: string;
  supplierName?: string | null;
  supplierId?: string | null;
  createdAt?: any;
  summary?: {
    poMatch?: boolean;
    counts?: {
      matched?: number;
      unknown?: number;
      priceChanges?: number;
      qtyDiffs?: number;
      missingOnInvoice?: number;
    };
    totals?: { ordered?: number; invoiced?: number; delta?: number };
  };
  invoice?: { poNumber?: string | null; source?: 'csv' | 'pdf' };
};

function parseTs(v: any): number {
  // normalize to epoch (ms) for sorting
  if (!v) return 0;
  if (typeof v.toDate === 'function') return v.toDate().getTime();
  if (v?._seconds) return v._seconds * 1000;
  const n = Date.parse(v);
  return Number.isFinite(n) ? n : 0;
}

function statusFor(rec: RecDoc): { label: 'matched' | 'changes' | 'review'; icon: '✔︎' | '!' | '?'; color: string } {
  const s = rec?.summary || {};
  const c = s?.counts || {};
  const poOk = s?.poMatch !== false;
  const hasChanges = (c.priceChanges || 0) > 0 || (c.qtyDiffs || 0) > 0;
  const needsReview = (c.unknown || 0) > 0 || (c.missingOnInvoice || 0) > 0 || s?.poMatch === false;

  if (!needsReview && !hasChanges && poOk) return { label: 'matched', icon: '✔︎', color: '#065F46' }; // green
  if (hasChanges) return { label: 'changes', icon: '!', color: '#92400E' }; // amber
  return { label: 'review', icon: '?', color: '#1E3A8A' }; // blue
}

function groupBySupplier(recs: RecDoc[]) {
  const bySup: Record<string, { supplierName: string; supplierId?: string | null; items: RecDoc[] }> = {};
  for (const r of recs) {
    const key = `${r.supplierId || ''}::${r.supplierName || 'Unknown supplier'}`;
    if (!bySup[key]) bySup[key] = { supplierName: r.supplierName || 'Unknown supplier', supplierId: r.supplierId || null, items: [] };
    bySup[key].items.push(r);
  }
  // sort each supplier's items newest first
  for (const k of Object.keys(bySup)) {
    bySup[k].items.sort((a, b) => parseTs(b.createdAt) - parseTs(a.createdAt));
  }
  // stable supplier sort by name
  return Object.values(bySup).sort((a, b) => a.supplierName.localeCompare(b.supplierName));
}

export default function ReconciliationCard({ venueId: propVenueId, onOpenOrder, maxSuppliers = 20, maxPerSupplier = 25 }: Props) {
  const ctxVenueId = useVenueId();
  const venueId = propVenueId || ctxVenueId;
  const db = getFirestore();

  const [loading, setLoading] = useState(false);
  const [recs, setRecs] = useState<RecDoc[]>([]);
  const [qText, setQText] = useState('');

  const load = useCallback(async () => {
    if (!venueId) return;
    setLoading(true);
    try {
      const out: RecDoc[] = [];

      // Single, venue-scoped path:
      // Scan recent orders, then grab last few reconciliations under each order.
      const ordersQ = query(
        collection(db, 'venues', venueId, 'orders'),
        orderBy('updatedAt', 'desc'),
        limit(maxSuppliers * 2) // heuristic
      );
      const oSnap = await getDocs(ordersQ);
      for (const o of oSnap.docs) {
        const ov: any = o.data() || {};
        const supplierName = ov?.supplierName || null;
        const supplierId = ov?.supplierId || null;
        const recQ = query(
          collection(db, 'venues', venueId, 'orders', o.id, 'reconciliations'),
          orderBy('createdAt', 'desc'),
          limit(Math.min(maxPerSupplier, 10))
        );
        const rSnap = await getDocs(recQ);
        rSnap.forEach(r => {
          const v: any = r.data() || {};
          out.push({
            id: r.id,
            orderId: o.id,
            supplierName: v?.supplierName ?? supplierName,
            supplierId: v?.supplierId ?? supplierId,
            createdAt: v?.createdAt || v?.ts || ov?.updatedAt || null,
            summary: v?.summary || null,
            invoice: v?.invoice || null,
          });
        });
      }

      setRecs(out);
    } finally {
      setLoading(false);
    }
  }, [db, venueId, maxSuppliers, maxPerSupplier]);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  const filtered = useMemo(() => {
    const q = qText.trim().toLowerCase();
    if (!q) return recs;
    return recs.filter(r => {
      const sName = (r.supplierName || '').toLowerCase();
      const po = (r.invoice?.poNumber || '').toLowerCase();
      const oid = (r.orderId || '').toLowerCase();
      return sName.includes(q) || po.includes(q) || oid.includes(q);
    });
  }, [recs, qText]);

  const grouped = useMemo(() => {
    const groups = groupBySupplier(filtered);
    // cap per supplier
    for (const g of groups) g.items = g.items.slice(0, maxPerSupplier);
    return groups.slice(0, maxSuppliers);
  }, [filtered, maxSuppliers, maxPerSupplier]);

  if (!venueId) {
    return (
      <View style={{ padding: 16, backgroundColor: '#FEF2F2', borderRadius: 12 }}>
        <Text style={{ color: '#991B1B', fontWeight: '800' }}>Select a venue to view reconciliations.</Text>
      </View>
    );
  }

  return (
    <View style={{ backgroundColor: '#0B1220', borderRadius: 12, overflow: 'hidden' }}>
      {/* Header */}
      <View style={{ padding: 16, borderBottomColor: '#1F2A44', borderBottomWidth: 1 }}>
        <Text style={{ color: 'white', fontWeight: '900', fontSize: 16 }}>Invoice Reconciliations</Text>
        <Text style={{ color: '#93A4C1', marginTop: 4, fontSize: 12 }}>
          Read-only. Grouped by supplier, newest first. Tap a row to open the order.
        </Text>

        {/* Search */}
        <View
          style={{
            marginTop: 12,
            backgroundColor: '#0F172A',
            borderColor: '#1E293B',
            borderWidth: 1,
            borderRadius: 10,
            paddingHorizontal: 12,
            paddingVertical: 8,
          }}
        >
          <TextInput
            value={qText}
            onChangeText={setQText}
            placeholder="Search supplier, PO, or Order ID"
            placeholderTextColor="#64748B"
            style={{ color: 'white', fontSize: 14 }}
            autoCorrect={false}
            autoCapitalize="none"
          />
        </View>
      </View>

      {loading ? (
        <View style={{ padding: 16, alignItems: 'center' }}>
          <ActivityIndicator />
          <Text style={{ color: '#93A4C1', marginTop: 8 }}>Loading…</Text>
        </View>
      ) : grouped.length === 0 ? (
        <View style={{ padding: 16 }}>
          <Text style={{ color: '#93A4C1' }}>No reconciliations yet.</Text>
        </View>
      ) : (
        <FlatList
          data={grouped}
          keyExtractor={g => `${g.supplierId || ''}:${g.supplierName}`}
          renderItem={({ item: group }) => (
            <View style={{ paddingHorizontal: 16, paddingVertical: 12, borderBottomColor: '#1F2A44', borderBottomWidth: 1 }}>
              {/* Supplier header */}
              <Text style={{ color: '#E2E8F0', fontWeight: '800', marginBottom: 8 }}>{group.supplierName}</Text>

              {group.items.map(r => {
                const st = statusFor(r);
                const created = parseTs(r.createdAt);
                const dt = created ? new Date(created) : null;
                const when = dt ? dt.toLocaleString() : '—';
                const po = r?.invoice?.poNumber || '—';
                return (
                  <TouchableOpacity
                    key={`${r.orderId}:${r.id}`}
                    onPress={() => onOpenOrder && onOpenOrder(r.orderId)}
                    style={{
                      paddingVertical: 10,
                      paddingHorizontal: 12,
                      borderRadius: 10,
                      backgroundColor: '#0F172A',
                      borderWidth: 1,
                      borderColor: '#1E293B',
                      marginBottom: 8,
                    }}
                  >
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={{ color: '#E5E7EB', fontWeight: '700' }}>Order {r.orderId.slice(0, 8)}</Text>
                      <View
                        style={{
                          paddingHorizontal: 8,
                          paddingVertical: 4,
                          borderRadius: 999,
                          borderWidth: 1,
                          borderColor: st.color,
                        }}
                      >
                        <Text style={{ color: st.color, fontWeight: '800', fontSize: 12 }}>
                          {st.icon} {st.label}
                        </Text>
                      </View>
                    </View>
                    <Text style={{ color: '#94A3B8', marginTop: 4, fontSize: 12 }}>PO: {po} · {when}</Text>
                    {r.summary?.totals ? (
                      <Text style={{ color: '#9CA3AF', marginTop: 2, fontSize: 12 }}>
                        Invoiced ${Number(r.summary.totals.invoiced || 0).toFixed(2)}
                        {Number.isFinite(r.summary.totals.delta) ? ` · Δ $${Number(r.summary.totals.delta || 0).toFixed(2)}` : ''}
                      </Text>
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        />
      )}
    </View>
  );
}
