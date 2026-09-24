// @ts-nocheck
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, ScrollView, Text, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import {
  collection, doc, getDocs, onSnapshot, query, where,
} from 'firebase/firestore';
import { db, auth } from '../../services/firebase';
import { useVenueId } from '../../context/VenueProvider';
import { FESTIVAL_BETA } from '../../config/festivalBeta';
import { useColours } from '../../context/ThemeContext';
import { useToast } from '../../components/common/Toast';
import { StockEntrySheet, EquipEntrySheet } from './components/OnHandEntrySheet';
import type { OnHandLocation } from './components/OnHandEntrySheet';

// ─── helpers ──────────────────────────────────────────────────────────────────

function formatQty(qtyUnits: number, packSize: number) {
  if (packSize > 1) {
    const cases = Math.floor(qtyUnits / packSize);
    const units = qtyUnits % packSize;
    if (cases > 0 && units > 0) return `${cases} cases + ${units} units`;
    if (cases > 0) return `${cases} cases`;
    return `${units} units`;
  }
  return `${qtyUnits} units`;
}

function fmtDate(ts: any) {
  if (!ts) return '';
  try {
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}`;
  } catch { return ''; }
}

const SOURCE_LABELS: Record<string, string> = {
  leftover: 'Leftover',
  pre_ordered: 'Pre-ordered',
  supplier_loan: 'Supplier loan',
  other: 'Other',
};

const OWNERSHIP_LABELS: Record<string, string> = {
  venue: 'Ours',
  supplier: 'Supplier',
  hired: 'Hired',
  other: 'Other',
};

function Chip({ label, color, bg }: { label: string; color: string; bg: string }) {
  return (
    <View style={{ backgroundColor: bg, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2, marginRight: 4 }}>
      <Text style={{ fontSize: 11, color, fontWeight: '600' }}>{label}</Text>
    </View>
  );
}

// ─── main screen ──────────────────────────────────────────────────────────────

export default function FestivalOnHandScreen() {
  const nav = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const venueId = useVenueId();
  const c = useColours();
  const { showError } = useToast();
  const uid = auth.currentUser?.uid;

  const [tab, setTab] = useState<'stock' | 'equipment'>('stock');
  const [role, setRole] = useState<string | null>(null);
  const [locations, setLocations] = useState<OnHandLocation[]>([]);
  const [stockItems, setStockItems] = useState<any[]>([]);
  const [equipItems, setEquipItems] = useState<any[]>([]);
  const [loadingLocations, setLoadingLocations] = useState(true);

  // Sheet state
  const [stockSheetOpen, setStockSheetOpen] = useState(false);
  const [equipSheetOpen, setEquipSheetOpen] = useState(false);
  const [editStockItem, setEditStockItem] = useState<any>(null);
  const [editEquipItem, setEditEquipItem] = useState<any>(null);

  // Role listener
  useEffect(() => {
    if (!venueId || !uid) return;
    const unsub = onSnapshot(doc(db, 'venues', venueId, 'members', uid), snap => {
      setRole(snap.exists() ? (snap.data() as any).role ?? null : null);
    });
    return () => unsub();
  }, [venueId, uid]);

  // Load locations once
  useFocusEffect(useCallback(() => {
    if (!venueId) return;
    let cancelled = false;
    (async () => {
      setLoadingLocations(true);
      try {
        const locs: OnHandLocation[] = [{ id: null, name: 'Not placed' }];

        // Storage spaces from departments/hq/areas
        try {
          const hqDept = await getDocs(query(collection(db, 'venues', venueId, 'departments'), where('key', '==', 'hq')));
          for (const deptDoc of hqDept.docs) {
            const areasSnap = await getDocs(collection(db, 'venues', venueId, 'departments', deptDoc.id, 'areas'));
            for (const areaDoc of areasSnap.docs) {
              const data = areaDoc.data() as any;
              locs.push({ id: areaDoc.id, name: data.name || areaDoc.id });
            }
          }
        } catch {}

        // Festival bars
        try {
          const barsSnap = await getDocs(query(
            collection(db, 'venues', venueId, 'departments'),
            where('isFestivalBar', '==', true),
          ));
          for (const barDoc of barsSnap.docs) {
            const data = barDoc.data() as any;
            locs.push({ id: barDoc.id, name: data.name || barDoc.id });
          }
        } catch {}

        if (!cancelled) setLocations(locs);
      } finally {
        if (!cancelled) setLoadingLocations(false);
      }
    })();
    return () => { cancelled = true; };
  }, [venueId]));

  // Stock onSnapshot
  useEffect(() => {
    if (!venueId) return;
    const unsub = onSnapshot(
      collection(db, 'venues', venueId, 'onHand'),
      { includeMetadataChanges: true },
      snap => {
        const items = snap.docs.map(d => ({ id: d.id, _pending: d.metadata.hasPendingWrites, ...d.data() }));
        setStockItems(items);
      },
      () => {},
    );
    return () => unsub();
  }, [venueId]);

  // Equipment onSnapshot
  useEffect(() => {
    if (!venueId) return;
    const unsub = onSnapshot(
      collection(db, 'venues', venueId, 'equipment'),
      { includeMetadataChanges: true },
      snap => {
        const items = snap.docs.map(d => ({ id: d.id, _pending: d.metadata.hasPendingWrites, ...d.data() }));
        setEquipItems(items);
      },
      () => {},
    );
    return () => unsub();
  }, [venueId]);

  const canEdit = role === 'owner' || role === 'manager';

  if (!FESTIVAL_BETA) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Text style={{ fontSize: 16, color: c.navy, textAlign: 'center' }}>On hand is coming soon.</Text>
      </View>
    );
  }

  // ── Location name lookup ──────────────────────────────────────────────────

  function locName(id: string | null) {
    if (id == null) return 'Not placed';
    const found = locations.find(l => l.id === id);
    return found ? found.name : id;
  }

  // ── Stock tab ─────────────────────────────────────────────────────────────

  // Group by location; "Not placed" (null) last
  const stockByLocation: Record<string, any[]> = {};
  stockItems.forEach(item => {
    const key = item.locationId ?? '__none__';
    if (!stockByLocation[key]) stockByLocation[key] = [];
    stockByLocation[key].push(item);
  });
  const locationKeys = Object.keys(stockByLocation).sort((a, b) => {
    if (a === '__none__') return 1;
    if (b === '__none__') return -1;
    return locName(a).localeCompare(locName(b));
  });

  // ── Equipment tab ─────────────────────────────────────────────────────────

  const hasShortfall = equipItems.some(e => {
    const q = Number(e.qty) || 0;
    const n = Number(e.need) || 0;
    return n > 0 && q < n;
  });
  const existingEquipNames = [...new Set(equipItems.map(e => e.name).filter(Boolean))] as string[];

  // ─── render ───────────────────────────────────────────────────────────────

  return (
    <SafeAreaView edges={['bottom']} style={{ flex: 1, backgroundColor: c.oat }}>

      {/* Sheets */}
      <StockEntrySheet
        visible={stockSheetOpen}
        editItem={editStockItem}
        locations={locations}
        onClose={() => { setStockSheetOpen(false); setEditStockItem(null); }}
      />
      <EquipEntrySheet
        visible={equipSheetOpen}
        editItem={editEquipItem}
        locations={locations}
        existingNames={existingEquipNames}
        onClose={() => { setEquipSheetOpen(false); setEditEquipItem(null); }}
      />

      {/* Tab bar */}
      <View style={{ flexDirection: 'row', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 4, borderBottomWidth: 1, borderBottomColor: c.border, backgroundColor: c.surface }}>
        {(['stock', 'equipment'] as const).map(t => (
          <TouchableOpacity
            key={t}
            onPress={() => setTab(t)}
            style={{ marginRight: 24, paddingBottom: 8, borderBottomWidth: 2, borderBottomColor: tab === t ? c.deepBlue : 'transparent' }}
          >
            <Text style={{ fontSize: 15, fontWeight: tab === t ? '700' : '400', color: tab === t ? c.deepBlue : c.slateMid }}>
              {t === 'stock' ? 'Stock' : 'Equipment'}
            </Text>
          </TouchableOpacity>
        ))}
        <View style={{ flex: 1 }} />
        {canEdit && (
          <TouchableOpacity
            onPress={() => {
              if (tab === 'stock') { setEditStockItem(null); setStockSheetOpen(true); }
              else { setEditEquipItem(null); setEquipSheetOpen(true); }
            }}
            style={{ backgroundColor: c.deepBlue, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 5 }}
          >
            <Text style={{ color: '#fff', fontWeight: '600', fontSize: 14 }}>+ Add</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Stock tab */}
      {tab === 'stock' && (
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 + insets.bottom }}>
          {stockItems.length === 0 && (
            <View style={{ alignItems: 'center', paddingTop: 48 }}>
              <Text style={{ fontSize: 36, marginBottom: 12 }}>🧺</Text>
              <Text style={{ fontSize: 16, fontWeight: '600', color: c.navy, marginBottom: 6 }}>No stock recorded yet</Text>
              <Text style={{ fontSize: 14, color: c.slateMid, textAlign: 'center' }}>
                {canEdit ? 'Tap + Add to record stock you already have on hand.' : 'Stock on hand will appear here once added.'}
              </Text>
            </View>
          )}
          {locationKeys.map(key => {
            const group = stockByLocation[key];
            const label = key === '__none__' ? 'Not placed' : locName(key === '__none__' ? null : key);
            return (
              <View key={key} style={{ marginBottom: 20 }}>
                <Text style={{ fontSize: 12, fontWeight: '700', color: c.slateMid, letterSpacing: 0.5, marginBottom: 8, textTransform: 'uppercase' }}>
                  {label}
                </Text>
                {group.map(item => (
                  <TouchableOpacity
                    key={item.id}
                    onPress={() => {
                      if (!canEdit) return;
                      setEditStockItem(item);
                      setStockSheetOpen(true);
                    }}
                    activeOpacity={canEdit ? 0.7 : 1}
                    style={{
                      backgroundColor: c.surface, borderRadius: 10, padding: 14,
                      marginBottom: 8, borderWidth: 1, borderColor: c.border,
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4, marginBottom: 4 }}>
                          <Text style={{ fontSize: 15, fontWeight: '600', color: c.navy }}>{item.productName || '—'}</Text>
                          {item._pending && (
                            <View style={{ backgroundColor: c.amber + '33', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1 }}>
                              <Text style={{ fontSize: 10, color: c.amber, fontWeight: '600' }}>Syncing</Text>
                            </View>
                          )}
                        </View>
                        <Text style={{ fontSize: 14, color: c.navy, marginBottom: 6 }}>
                          {formatQty(item.qtyUnits || 0, item.packSize || 1)}
                        </Text>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                          {item.source && (
                            <Chip label={SOURCE_LABELS[item.source] || item.source} color={c.deepBlue} bg={c.deepBlue + '18'} />
                          )}
                          {item.inTransit && (
                            <Chip label="In transit" color={c.amber} bg={c.amber + '22'} />
                          )}
                        </View>
                        {item.updatedAt && (
                          <Text style={{ fontSize: 12, color: c.slateMid, marginTop: 4 }}>
                            Updated {fmtDate(item.updatedAt)}{item.updatedBy ? ` · ${item.updatedBy.slice(0, 8)}` : ''}
                          </Text>
                        )}
                      </View>
                      {canEdit && <Text style={{ fontSize: 18, color: c.slateMid, marginLeft: 8 }}>›</Text>}
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            );
          })}
        </ScrollView>
      )}

      {/* Equipment tab */}
      {tab === 'equipment' && (
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 + insets.bottom }}>

          {/* Shortfall card */}
          {hasShortfall && (
            <View style={{
              backgroundColor: c.amber + '22', borderLeftWidth: 3, borderLeftColor: c.amber,
              borderRadius: 8, padding: 14, marginBottom: 16,
            }}>
              <Text style={{ fontSize: 14, fontWeight: '700', color: c.navy, marginBottom: 4 }}>Equipment shortfall</Text>
              <Text style={{ fontSize: 13, color: c.navy }}>
                {equipItems.filter(e => (Number(e.need) || 0) > (Number(e.qty) || 0)).map(e => e.name).join(', ')} need{equipItems.filter(e => (Number(e.need) || 0) > (Number(e.qty) || 0)).length === 1 ? 's' : ''} more than available.
              </Text>
            </View>
          )}

          {equipItems.length === 0 && (
            <View style={{ alignItems: 'center', paddingTop: 48 }}>
              <Text style={{ fontSize: 36, marginBottom: 12 }}>🔧</Text>
              <Text style={{ fontSize: 16, fontWeight: '600', color: c.navy, marginBottom: 6 }}>No equipment recorded yet</Text>
              <Text style={{ fontSize: 14, color: c.slateMid, textAlign: 'center' }}>
                {canEdit ? 'Tap + Add to track tap heads, keg couplers and other equipment.' : 'Equipment will appear here once added.'}
              </Text>
            </View>
          )}

          {equipItems.map(item => {
            const q = Number(item.qty) || 0;
            const n = Number(item.need) || 0;
            const short = n > 0 && q < n;
            return (
              <TouchableOpacity
                key={item.id}
                onPress={() => {
                  if (!canEdit) return;
                  setEditEquipItem(item);
                  setEquipSheetOpen(true);
                }}
                activeOpacity={canEdit ? 0.7 : 1}
                style={{
                  backgroundColor: c.surface, borderRadius: 10, padding: 14,
                  marginBottom: 8, borderWidth: 1,
                  borderColor: short ? c.amber : c.border,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4, marginBottom: 4 }}>
                      <Text style={{ fontSize: 15, fontWeight: '600', color: c.navy }}>{item.name || '—'}</Text>
                      {item._pending && (
                        <View style={{ backgroundColor: c.amber + '33', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1 }}>
                          <Text style={{ fontSize: 10, color: c.amber, fontWeight: '600' }}>Syncing</Text>
                        </View>
                      )}
                      {short && (
                        <View style={{ backgroundColor: c.amber + '22', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1 }}>
                          <Text style={{ fontSize: 11, color: c.amber, fontWeight: '700' }}>Short {n - q}</Text>
                        </View>
                      )}
                    </View>
                    <Text style={{ fontSize: 14, color: c.navy, marginBottom: 4 }}>
                      {q} on hand{n > 0 ? ` · ${n} needed` : ''}
                    </Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                      {item.ownership && (
                        <Chip label={OWNERSHIP_LABELS[item.ownership] || item.ownership} color={c.deepBlue} bg={c.deepBlue + '18'} />
                      )}
                      {item.locationId && (
                        <Chip label={locName(item.locationId)} color={c.slateMid} bg={c.border} />
                      )}
                    </View>
                    {item.notes ? (
                      <Text style={{ fontSize: 12, color: c.slateMid, marginTop: 4 }} numberOfLines={2}>{item.notes}</Text>
                    ) : null}
                  </View>
                  {canEdit && <Text style={{ fontSize: 18, color: c.slateMid, marginLeft: 8 }}>›</Text>}
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
