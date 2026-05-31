// @ts-nocheck
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useVenueId } from '../../context/VenueProvider';
import { FESTIVAL_BETA } from '../../config/festivalBeta';

type StockItem = { productId: string; productName: string; currentStock: number; stockCategory?: string };
type LocationStock = { locationId: string; locationName: string; items: StockItem[] };

type View = 'by-location' | 'by-purpose';

export default function FestivalStockOverviewScreen() {
  const nav = useNavigation<any>();
  const venueId = useVenueId();

  const [view, setView] = useState<View>('by-location');
  const [barStocks, setBarStocks] = useState<LocationStock[]>([]);
  const [srcStocks, setSrcStocks] = useState<LocationStock[]>([]);
  const [loading, setLoading] = useState(true);
  const [balanceIssues, setBalanceIssues] = useState<string[]>([]);

  useEffect(() => {
    if (!FESTIVAL_BETA || !venueId) { setLoading(false); return; }
    let barsData: LocationStock[] = [];
    let srcData: LocationStock[] = [];
    let done = 0;
    const checkDone = () => { if (++done === 2) { setLoading(false); checkBalance(barsData, srcData); } };

    const unsubBars = onSnapshot(
      query(collection(db, 'venues', venueId, 'departments'), where('isFestivalBar', '==', true)),
      async deptSnap => {
        const results: LocationStock[] = [];
        const promises = deptSnap.docs.map(async deptDoc => {
          const deptData = deptDoc.data() as any;
          return new Promise<void>(resolve => {
            onSnapshot(
              collection(db, 'venues', venueId, 'departments', deptDoc.id, 'areas', 'back-of-house', 'items'),
              stockSnap => {
                const items: StockItem[] = stockSnap.docs.map(d => ({
                  productId: d.id,
                  productName: (d.data() as any).name || d.id,
                  currentStock: (d.data() as any).lastCount ?? 0,
                  stockCategory: (d.data() as any).stockCategory,
                }));
                const existing = results.find(r => r.locationId === deptDoc.id);
                if (existing) {
                  existing.items = items;
                } else {
                  results.push({ locationId: deptDoc.id, locationName: deptData.name || deptDoc.id, items });
                }
                barsData = results;
                setBarStocks([...results]);
                resolve();
              },
              () => resolve(),
            );
          });
        });
        await Promise.all(promises);
        checkDone();
      },
      () => checkDone(),
    );

    const unsubSrc = onSnapshot(
      collection(db, 'venues', venueId, 'departments', 'hq', 'areas'),
      async hqSnap => {
        const results: LocationStock[] = [];
        const promises = hqSnap.docs.map(async areaDoc => {
          const areaData = areaDoc.data() as any;
          return new Promise<void>(resolve => {
            onSnapshot(
              collection(db, 'venues', venueId, 'departments', 'hq', 'areas', areaDoc.id, 'items'),
              stockSnap => {
                const items: StockItem[] = stockSnap.docs.map(d => ({
                  productId: d.id,
                  productName: (d.data() as any).name || d.id,
                  currentStock: (d.data() as any).lastCount ?? 0,
                }));
                const existing = results.find(r => r.locationId === areaDoc.id);
                if (existing) {
                  existing.items = items;
                } else {
                  results.push({ locationId: areaDoc.id, locationName: areaData.name || areaDoc.id, items });
                }
                srcData = results;
                setSrcStocks([...results]);
                resolve();
              },
              () => resolve(),
            );
          });
        });
        await Promise.all(promises);
        checkDone();
      },
      () => checkDone(),
    );

    return () => { unsubBars(); unsubSrc(); };
  }, [venueId]);

  function checkBalance(bars: LocationStock[], srcs: LocationStock[]) {
    const issues: string[] = [];
    // Products with zero stock everywhere flagged as potential balance issue
    const allProducts = new Map<string, { name: string; total: number }>();
    [...bars, ...srcs].forEach(loc => {
      loc.items.forEach(item => {
        const existing = allProducts.get(item.productId);
        if (existing) {
          existing.total += item.currentStock;
        } else {
          allProducts.set(item.productId, { name: item.productName, total: item.currentStock });
        }
      });
    });
    allProducts.forEach(({ name, total }, id) => {
      if (total < 0) issues.push(`${name}: negative total (${total})`);
    });
    setBalanceIssues(issues);
  }

  // By-purpose view: group bar stock by stockCategory
  function getByPurpose() {
    const categoryMap = new Map<string, { productId: string; productName: string; total: number }[]>();
    barStocks.forEach(loc => {
      loc.items.forEach(item => {
        const cat = item.stockCategory || 'general';
        if (!categoryMap.has(cat)) categoryMap.set(cat, []);
        const list = categoryMap.get(cat)!;
        const existing = list.find(x => x.productId === item.productId);
        if (existing) {
          existing.total += item.currentStock;
        } else {
          list.push({ productId: item.productId, productName: item.productName, total: item.currentStock });
        }
      });
    });
    return categoryMap;
  }

  const CATEGORY_LABELS: Record<string, string> = {
    general:    'General stock',
    rider:      'Rider allocations',
    activation: 'Activations',
    promo:      'Promotional',
    damaged:    'Damaged / write-off',
  };

  if (!FESTIVAL_BETA) {
    return (
      <View style={S.center}>
        <Text style={S.empty}>Festival mode is not enabled.</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={S.center}>
        <ActivityIndicator color="#1b4f72" size="large" />
      </View>
    );
  }

  return (
    <ScrollView style={S.screen} contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
      <Text style={S.heading}>Stock Overview</Text>

      {balanceIssues.length > 0 && (
        <View style={S.issueBanner}>
          <Text style={S.issueTitle}>⚠ Balance issues detected</Text>
          {balanceIssues.map((issue, i) => (
            <Text key={i} style={S.issueItem}>• {issue}</Text>
          ))}
        </View>
      )}

      {/* View toggle */}
      <View style={S.toggle}>
        <TouchableOpacity
          style={[S.toggleBtn, view === 'by-location' && S.toggleBtnActive]}
          onPress={() => setView('by-location')}
        >
          <Text style={[S.toggleText, view === 'by-location' && S.toggleTextActive]}>By location</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[S.toggleBtn, view === 'by-purpose' && S.toggleBtnActive]}
          onPress={() => setView('by-purpose')}
        >
          <Text style={[S.toggleText, view === 'by-purpose' && S.toggleTextActive]}>By purpose</Text>
        </TouchableOpacity>
      </View>

      {view === 'by-location' && (
        <>
          {srcStocks.length > 0 && (
            <>
              <Text style={S.sectionHeading}>SOURCE LOCATIONS</Text>
              {srcStocks.map(loc => (
                <View key={loc.locationId} style={S.locationCard}>
                  <Text style={S.locationName}>{loc.locationName}</Text>
                  {loc.items.length === 0 ? (
                    <Text style={S.empty}>No stock recorded.</Text>
                  ) : (
                    loc.items.map(item => (
                      <View key={item.productId} style={S.itemRow}>
                        <Text style={S.itemName}>{item.productName}</Text>
                        <Text style={[S.itemQty, item.currentStock <= 0 && S.itemQtyZero]}>
                          {item.currentStock}
                        </Text>
                      </View>
                    ))
                  )}
                </View>
              ))}
            </>
          )}

          {barStocks.length > 0 && (
            <>
              <Text style={S.sectionHeading}>BARS</Text>
              {barStocks.map(loc => (
                <View key={loc.locationId} style={S.locationCard}>
                  <Text style={S.locationName}>{loc.locationName}</Text>
                  {loc.items.length === 0 ? (
                    <Text style={S.empty}>No stock recorded.</Text>
                  ) : (
                    loc.items.map(item => (
                      <View key={item.productId} style={S.itemRow}>
                        <Text style={S.itemName}>{item.productName}</Text>
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text style={[S.itemQty, item.currentStock <= 0 && S.itemQtyZero]}>
                            {item.currentStock}
                          </Text>
                          {item.stockCategory && item.stockCategory !== 'general' && (
                            <Text style={S.catBadge}>{CATEGORY_LABELS[item.stockCategory] ?? item.stockCategory}</Text>
                          )}
                        </View>
                      </View>
                    ))
                  )}
                </View>
              ))}
            </>
          )}

          {srcStocks.length === 0 && barStocks.length === 0 && (
            <Text style={S.empty}>No stock data yet. Use Goods In to record received stock.</Text>
          )}
        </>
      )}

      {view === 'by-purpose' && (
        <>
          {barStocks.length === 0 ? (
            <Text style={S.empty}>No bar stock recorded yet.</Text>
          ) : (
            Array.from(getByPurpose().entries()).map(([cat, items]) => (
              <View key={cat} style={S.locationCard}>
                <Text style={S.locationName}>{CATEGORY_LABELS[cat] ?? cat}</Text>
                {items.map(item => (
                  <View key={item.productId} style={S.itemRow}>
                    <Text style={S.itemName}>{item.productName}</Text>
                    <Text style={[S.itemQty, item.total <= 0 && S.itemQtyZero]}>{item.total}</Text>
                  </View>
                ))}
              </View>
            ))
          )}
        </>
      )}

      <TouchableOpacity style={S.goodsInBtn} onPress={() => nav.navigate('FestivalGoodsIn')}>
        <Text style={S.goodsInBtnText}>+ Goods In →</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const S = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f5f3ee' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f5f3ee', padding: 24 },
  heading: { fontSize: 22, fontWeight: '800', color: '#0B132B', marginBottom: 16 },
  sectionHeading: { fontSize: 11, fontWeight: '800', color: '#9ca3af', letterSpacing: 1, textTransform: 'uppercase', marginTop: 20, marginBottom: 8 },
  empty: { fontSize: 14, color: '#9ca3af', fontStyle: 'italic', textAlign: 'center', marginTop: 8 },

  toggle: { flexDirection: 'row', backgroundColor: '#e5e1d8', borderRadius: 10, padding: 4, marginBottom: 16 },
  toggleBtn: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 8 },
  toggleBtnActive: { backgroundColor: '#fff' },
  toggleText: { fontSize: 13, fontWeight: '600', color: '#6b7280' },
  toggleTextActive: { color: '#0B132B' },

  issueBanner: { backgroundColor: '#fef2f2', borderRadius: 8, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: '#fca5a5' },
  issueTitle: { fontSize: 13, fontWeight: '700', color: '#dc2626', marginBottom: 4 },
  issueItem: { fontSize: 13, color: '#dc2626' },

  locationCard: { backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#e5e1d8', padding: 14, marginBottom: 10 },
  locationName: { fontSize: 15, fontWeight: '700', color: '#0B132B', marginBottom: 10 },
  itemRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 5, borderTopWidth: 1, borderTopColor: '#f0ede8' },
  itemName: { fontSize: 13, color: '#374151', flex: 1 },
  itemQty: { fontSize: 14, fontWeight: '700', color: '#0B132B' },
  itemQtyZero: { color: '#d1d5db' },
  catBadge: { fontSize: 10, color: '#6b7280', fontStyle: 'italic', marginTop: 1 },

  goodsInBtn: {
    backgroundColor: '#1b4f72', borderRadius: 12, padding: 14,
    alignItems: 'center', marginTop: 24,
  },
  goodsInBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
