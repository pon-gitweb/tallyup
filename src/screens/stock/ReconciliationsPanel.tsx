// @ts-nocheck
import React, { useMemo, useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Platform } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { collection, getDocs, orderBy, query, limit } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useVenueId } from '../../context/VenueProvider';

type Rec = {
  id: string;
  orderId: string;
  supplierName?: string | null;
  createdAt?: any;
  totals?: { invoiceTotal?: number | null; orderTotal?: number | null };
  anomalies?: any[];
};

export default function ReconciliationsPanel() {
  const venueId = useVenueId();
  const nav = useNavigation<any>();

  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<Rec[]>([]);
  const [expanded, setExpanded] = useState(false);

  // Inline async effect (no external hook)
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!venueId) return;
        const q = query(
          collection(db, 'venues', venueId, 'reconciliations'),
          orderBy('createdAt', 'desc'),
          limit(100)
        );
        const snap = await getDocs(q);
        if (!alive) return;
        const out: Rec[] = [];
        snap.forEach(d => out.push({ id: d.id, ...(d.data() as any) }));
        setRows(out);
      } catch (e) {
        if (__DEV__) console.log('[ReconciliationsPanel] load failed', e);
      }
    })();
    return () => { alive = false; };
  }, [venueId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r => {
      const s = (r.supplierName || '').toLowerCase();
      const o = (r.orderId || '').toLowerCase();
      return s.includes(q) || o.includes(q);
    });
  }, [rows, search]);

  // Group by supplier, then by date (YYYY-MM-DD)
  const grouped = useMemo(() => {
    const bySupplier: Record<string, Record<string, Rec[]>> = {};
    for (const r of filtered) {
      const s = r.supplierName || 'Unknown Supplier';
      const ts = (r.createdAt?.toDate ? r.createdAt.toDate() : new Date(r.createdAt || Date.now()));
      const day = isNaN(+ts) ? 'Unknown Date' : ts.toISOString().slice(0,10);
      bySupplier[s] = bySupplier[s] || {};
      bySupplier[s][day] = bySupplier[s][day] || [];
      bySupplier[s][day].push(r);
    }
    return bySupplier;
  }, [filtered]);

  const CardRow = ({ rec }: { rec: Rec }) => {
    const inv = rec?.totals?.invoiceTotal ?? null;
    const ord = rec?.totals?.orderTotal ?? null;
    const deltaKnown = Number.isFinite(inv) && Number.isFinite(ord);
    const delta = deltaKnown ? Number(inv) - Number(ord) : null;
    const issues = Array.isArray(rec?.anomalies) ? rec.anomalies.length : 0;

    const badge = deltaKnown ? (Math.abs(delta!) < 0.005 ? '✓ match' : '≠ variance') : ' ? review';
    const badgeBg = deltaKnown
      ? (Math.abs(delta!) < 0.005 ? '#065F46' : '#7C2D12')
      : '#334155';

    return (
      <TouchableOpacity
        onPress={() => nav.navigate('OrderDetail', { orderId: rec.orderId })}
        style={S.row}
      >
        <View style={{ flex: 1 }}>
          <Text style={S.rowTitle}>Order {rec.orderId}</Text>
          <Text style={S.rowSub}>
            Invoiced: {inv == null ? '—' : `$${Number(inv).toFixed(2)}`} ·
            Order: {ord == null ? '—' : `$${Number(ord).toFixed(2)}`} ·
            {deltaKnown ? `Δ ${delta!>=0?'+':''}${delta!.toFixed(2)}` : 'Δ —'}
          </Text>
          <Text style={S.rowSub}>
            Changes: {issues || 0}
          </Text>
        </View>
        <View style={[S.badge,{ backgroundColor: badgeBg }]}>
          <Text style={{ color:'white', fontWeight:'800', fontSize:12 }}>{badge}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  const content = (
    <View style={{ gap: 14 }}>
      {Object.keys(grouped).length === 0 ? (
        <Text style={{ color:'#CBD5E1' }}>No reconciliations yet.</Text>
      ) : (
        Object.entries(grouped).map(([supplier, byDay]) => (
          <View key={supplier} style={{ gap: 8 }}>
            <Text style={S.groupTitle}>{supplier}</Text>
            {Object.entries(byDay).map(([day, list]) => (
              <View key={supplier+day} style={{ gap: 6 }}>
                <Text style={S.dayTitle}>{day}</Text>
                {list.map(rec => <CardRow key={rec.id} rec={rec} />)}
              </View>
            ))}
          </View>
        ))
      )}
    </View>
  );

  return (
    <View style={S.card}>
      <Text style={S.title}>Invoice Reconciliations</Text>
      <Text style={S.sub}>Read-only. Grouped by supplier, newest first. Tap a row to open the order.</Text>

      <TextInput
        placeholder="Search supplier, PO, or Order ID"
        value={search}
        onChangeText={setSearch}
        placeholderTextColor="#64748B"
        style={S.search}
      />

      {/* Internal scroller: capped height unless expanded */}
      <View style={[S.scrollShell, expanded ? S.scrollExpanded : null]}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: 8 }}
          showsVerticalScrollIndicator
        >
          {content}
        </ScrollView>
      </View>

      <TouchableOpacity onPress={() => setExpanded(e => !e)} style={S.expandBtn}>
        <Text style={S.expandTxt}>{expanded ? 'Collapse' : 'Expand'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const S = StyleSheet.create({
  card: { backgroundColor:'#0F172A', padding:14, borderRadius:12, marginTop:10 },
  title: { color:'white', fontWeight:'900', fontSize:16 },
  sub: { color:'#93A3B8', marginTop:4 },
  search: {
    marginTop:10, borderWidth:1, borderColor:'#1F2937', backgroundColor:'#0B1220',
    borderRadius:10, paddingVertical:10, paddingHorizontal:12, color:'white'
  },
  scrollShell: {
    marginTop:12,
    maxHeight: Platform.select({ ios: 560, android: 560 }),
    borderRadius:10,
    overflow:'hidden',
    borderWidth:1, borderColor:'#1F2937'
  },
  scrollExpanded: {
    maxHeight: undefined, // full height inside page scroll
  },
  groupTitle: { color:'#E2E8F0', fontWeight:'800', marginTop:6 },
  dayTitle: { color:'#94A3B8', fontWeight:'700', marginTop:2 },
  row: {
    backgroundColor:'#0B1220', borderRadius:10, padding:12,
    borderWidth:1, borderColor:'#1E293B', flexDirection:'row', alignItems:'center', gap:12
  },
  rowTitle: { color:'white', fontWeight:'800' },
  rowSub: { color:'#93A3AF', marginTop:2 },
  badge: { paddingVertical:6, paddingHorizontal:10, borderRadius:999 },
  expandBtn: { alignSelf:'center', marginTop:10, paddingVertical:8, paddingHorizontal:12 },
  expandTxt: { color:'#93C5FD', fontWeight:'800' },
});
