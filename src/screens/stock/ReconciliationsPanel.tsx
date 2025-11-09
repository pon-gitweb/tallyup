// @ts-nocheck
import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Platform, Modal } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { collection, getDocs, orderBy, query, limit } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useVenueId } from '../../context/VenueProvider';
import { summarize } from '../../services/analytics/reconciliationAnalytics';

type Rec = {
  id: string;
  orderId: string;
  supplierName?: string | null;
  createdAt?: any;
  totals?: { invoiceTotal?: number | null; orderTotal?: number | null; delta?: number | null };
  counts?: { matched?: number; unknown?: number; priceChanges?: number; qtyDiffs?: number; missingOnInvoice?: number };
  anomalies?: any[] | null;
  poMatch?: boolean;
};

function fmtMoney(n?: number | null) {
  const v = Number(n ?? NaN);
  if (!Number.isFinite(v)) return '—';
  const s = v >= 0 ? '' : '-';
  return `${s}$${Math.abs(v).toFixed(2)}`;
}

export default function ReconciliationsPanel() {
  const venueId = useVenueId();
  const nav = useNavigation<any>();

  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<Rec[]>([]);
  const [expanded, setExpanded] = useState(false);

  // Details modal state
  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState<Rec | null>(null);

  // Inline async effect (no external hook)
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!venueId) return;
        const qRef = query(
          collection(db, 'venues', venueId, 'reconciliations'),
          orderBy('createdAt', 'desc'),
          limit(100)
        );
        const snap = await getDocs(qRef);
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

  const stats = useMemo(() => summarize(filtered as any), [filtered]);

  const openDetail = useCallback((rec: Rec) => {
    setDetail(rec);
    setDetailOpen(true);
  }, []);

  const CardRow = ({ rec }: { rec: Rec }) => {
    const inv = rec?.totals?.invoiceTotal ?? null;
    const ord = rec?.totals?.orderTotal ?? null;
    const deltaKnown = Number.isFinite(Number(inv)) && Number.isFinite(Number(ord));
    const delta = deltaKnown ? Number(inv) - Number(ord) : (rec?.totals?.delta ?? null);
    const issues = Array.isArray(rec?.anomalies) ? rec.anomalies.length : 0;

    const badge = deltaKnown ? (Math.abs(Number(delta)) < 0.005 ? '✓ match' : '≠ variance') : ' ? review';
    const badgeBg = deltaKnown
      ? (Math.abs(Number(delta)) < 0.005 ? '#065F46' : '#7C2D12')
      : '#334155';

    return (
      <TouchableOpacity
        onPress={() => nav.navigate('OrderDetail', { orderId: rec.orderId })}
        onLongPress={() => openDetail(rec)}
        delayLongPress={300}
        style={S.row}
      >
        <View style={{ flex: 1 }}>
          <Text style={S.rowTitle}>Order {rec.orderId}</Text>
          <Text style={S.rowSub}>
            Invoiced: {fmtMoney(inv)} · Order: {fmtMoney(ord)} · {deltaKnown ? `Δ ${Number(delta)>=0?'+':''}${Number(delta).toFixed(2)}` : 'Δ —'}
          </Text>
          <Text style={S.rowSub}>
            Changes: {issues || 0} {rec?.poMatch ? '· PO ✓' : '· PO ?'}
          </Text>
        </View>
        <View style={[S.badge,{ backgroundColor: badgeBg }]}>
          <Text style={{ color:'white', fontWeight:'800', fontSize:12 }}>{badge}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  const TrendBar = ({ data }:{ data: Array<{day:string; delta:number}> }) => {
    if (!data?.length) return null;
    // Render as a tiny inline sparkline-style bar row (text-only; no libs)
    const maxAbs = Math.max(1, ...data.map(d => Math.abs(d.delta)));
    return (
      <View style={{ flexDirection:'row', gap:2, alignItems:'flex-end', marginTop:6 }}>
        {data.map((d, i) => {
          const h = Math.max(2, Math.round((Math.abs(d.delta)/maxAbs) * 24));
          const up = d.delta >= 0;
          return <View key={i} style={{ width:4, height:h, backgroundColor: up ? '#7C2D12' : '#065F46', borderRadius:2 }} />;
        })}
      </View>
    );
  };

  const SummaryTiles = () => (
    <View style={S.tiles}>
      <View style={S.tile}>
        <Text style={S.tileLabel}>Reconciliations</Text>
        <Text style={S.tileValue}>{stats.count}</Text>
      </View>
      <View style={S.tile}>
        <Text style={S.tileLabel}>PO Match</Text>
        <Text style={S.tileValue}>{stats.poMatchPct}%</Text>
      </View>
      <View style={S.tile}>
        <Text style={S.tileLabel}>Total Δ</Text>
        <Text style={S.tileValue}>{fmtMoney(stats.totalDelta)}</Text>
      </View>
      <View style={S.tile}>
        <Text style={S.tileLabel}>Avg Δ</Text>
        <Text style={S.tileValue}>{fmtMoney(stats.avgDelta)}</Text>
      </View>
    </View>
  );

  const DetailModal = () => {
    if (!detail) return null;
    const inv = detail?.totals?.invoiceTotal ?? null;
    const ord = detail?.totals?.orderTotal ?? null;
    const deltaKnown = Number.isFinite(Number(inv)) && Number.isFinite(Number(ord));
    const delta = deltaKnown ? Number(inv) - Number(ord) : (detail?.totals?.delta ?? null);
    const issues = Array.isArray(detail?.anomalies) ? detail.anomalies : [];

    return (
      <Modal visible={detailOpen} animationType="slide" onRequestClose={()=>setDetailOpen(false)}>
        <View style={{ flex:1, backgroundColor:'#fff' }}>
          <View style={{ padding:16, borderBottomWidth:StyleSheet.hairlineWidth, borderBottomColor:'#e5e7eb' }}>
            <Text style={{ fontSize:18, fontWeight:'900' }}>Reconciliation Details</Text>
            <Text style={{ color:'#6B7280', marginTop:4 }}>
              Supplier: {detail?.supplierName || '—'} · Order {detail?.orderId} {detail?.poMatch ? '· PO ✓' : '· PO ?'}
            </Text>
          </View>

          <ScrollView style={{ flex:1 }}>
            <View style={{ padding:16, gap:8 }}>
              <Text style={{ fontWeight:'800' }}>Totals</Text>
              <Text style={{ color:'#475569' }}>Invoice: {fmtMoney(inv)} · Order: {fmtMoney(ord)} · Δ {delta==null?'—':`${delta>=0?'+':''}${Number(delta).toFixed(2)}`}</Text>

              <Text style={{ fontWeight:'800', marginTop:12 }}>Counts</Text>
              <Text style={{ color:'#475569' }}>
                {`matched: ${detail?.counts?.matched ?? 0} · unknown: ${detail?.counts?.unknown ?? 0} · price: ${detail?.counts?.priceChanges ?? 0} · qty: ${detail?.counts?.qtyDiffs ?? 0} · missing: ${detail?.counts?.missingOnInvoice ?? 0}`}
              </Text>

              <Text style={{ fontWeight:'800', marginTop:12 }}>Anomalies</Text>
              {issues.length === 0 ? (
                <Text style={{ color:'#475569' }}>None</Text>
              ) : (
                issues.map((a, i) => <Text key={i} style={{ color:'#475569' }}>• {typeof a === 'string' ? a : JSON.stringify(a)}</Text>)
              )}
            </View>
          </ScrollView>

          <View style={{ padding:16, borderTopWidth:StyleSheet.hairlineWidth, borderTopColor:'#e5e7eb' }}>
            <TouchableOpacity onPress={()=>setDetailOpen(false)} style={{ backgroundColor:'#111827', borderRadius:10, padding:12 }}>
              <Text style={{ color:'#fff', textAlign:'center', fontWeight:'800' }}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
      <Text style={S.sub}>Read-only. Grouped by supplier, newest first. Tap to open order; long-press for details.</Text>

      {/* Summary tiles + tiny variance trend */}
      <SummaryTiles />
      <View style={{ marginTop:6 }}>
        <Text style={{ color:'#93A3B8', fontWeight:'700' }}>14-day Δ trend</Text>
        <TrendBar data={stats.last14} />
      </View>

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

      <DetailModal />
    </View>
  );
}

const S = StyleSheet.create({
  card: { backgroundColor:'#0F172A', padding:14, borderRadius:12, marginTop:10 },
  title: { color:'white', fontWeight:'900', fontSize:16 },
  sub: { color:'#93A3B8', marginTop:4 },
  tiles: { flexDirection:'row', gap:8, marginTop:10, flexWrap:'wrap' },
  tile: { backgroundColor:'#0B1220', borderColor:'#1E293B', borderWidth:1, borderRadius:10, padding:10, minWidth:120 },
  tileLabel: { color:'#94A3B8', fontSize:12, fontWeight:'700' },
  tileValue: { color:'#E2E8F0', fontSize:16, fontWeight:'900', marginTop:2 },

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
  scrollExpanded: { maxHeight: undefined },
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
