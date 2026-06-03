// @ts-nocheck
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import {
  collection, doc, getDoc, getDocs, increment, onSnapshot, setDoc, writeBatch, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useVenueId } from '../../context/VenueProvider';
import { FESTIVAL_BETA } from '../../config/festivalBeta';

type SourceLocation = { id: string; name: string; type: string; distributionConfirmed?: boolean };
type Bar = { id: string; name: string };
type Product = { id: string; name: string };

type DeliveryLine = {
  productId: string;
  productName: string;
  receivedQty: number;
  expectedQty: number;
};

type Allocation = {
  barId: string;
  barName: string;
  qty: number;
};

type AllocationMap = Record<string, Allocation[]>; // productId → allocations per bar

export default function FestivalGoodsInScreen() {
  const nav = useNavigation<any>();
  const venueId = useVenueId();

  const [phase, setPhase] = useState<'receive' | 'distribute'>('receive');
  const [sourceLocations, setSourceLocations] = useState<SourceLocation[]>([]);
  const [bars, setBars] = useState<Bar[]>([]);
  const [selectedLocation, setSelectedLocation] = useState<SourceLocation | null>(null);
  const [lines, setLines] = useState<DeliveryLine[]>([]);
  const [allocations, setAllocations] = useState<AllocationMap>({});
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [chepReceived, setChepReceived] = useState('');
  const [chepEnabled, setChepEnabled] = useState(false);

  useEffect(() => {
    if (!FESTIVAL_BETA || !venueId) { setLoading(false); return; }
    let done = 0;
    const checkDone = () => { if (++done === 2) setLoading(false); };

    const unsubLocs = onSnapshot(
      collection(db, 'venues', venueId, 'departments', 'hq', 'areas'),
      snap => {
        setSourceLocations(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
        checkDone();
      },
      () => checkDone(),
    );
    const unsubBars = onSnapshot(
      collection(db, 'venues', venueId, 'departments'),
      snap => {
        setBars(
          snap.docs
            .filter(d => (d.data() as any).isFestivalBar === true)
            .map(d => ({ id: d.id, name: (d.data() as any).name || d.id }))
        );
        checkDone();
      },
      () => checkDone(),
    );
    return () => { unsubLocs(); unsubBars(); };
  }, [venueId]);

  // Load products for selected source location
  useEffect(() => {
    if (!selectedLocation || !venueId) return;
    (async () => {
      try {
        const snap = await getDocs(
          collection(db, 'venues', venueId, 'departments', 'hq', 'areas', selectedLocation.id, 'items')
        );
        const loaded: DeliveryLine[] = snap.docs.map(d => {
          const data = d.data() as any;
          return {
            productId: d.id,
            productName: data.name || d.id,
            receivedQty: 0,
            expectedQty: data.lastCount ?? 0,
          };
        });
        setLines(loaded);
        // Initialise empty allocations for each product
        const initial: AllocationMap = {};
        loaded.forEach(l => {
          initial[l.productId] = bars.map(b => ({ barId: b.id, barName: b.name, qty: 0 }));
        });
        setAllocations(initial);
      } catch (e: any) {
        Alert.alert('Error', e?.message || 'Could not load stock.');
      }
    })();
  }, [selectedLocation?.id, bars.length]);

  function updateReceivedQty(productId: string, text: string) {
    const n = parseFloat(text) || 0;
    setLines(prev => prev.map(l => l.productId === productId ? { ...l, receivedQty: n } : l));
  }

  function updateAllocation(productId: string, barId: string, text: string) {
    const n = parseFloat(text) || 0;
    setAllocations(prev => ({
      ...prev,
      [productId]: (prev[productId] || []).map(a =>
        a.barId === barId ? { ...a, qty: n } : a
      ),
    }));
  }

  // Shortfall detection: total allocated > received for any product
  function getShortfalls(): string[] {
    return lines
      .filter(l => {
        const total = (allocations[l.productId] || []).reduce((s, a) => s + a.qty, 0);
        return total > l.receivedQty;
      })
      .map(l => l.productName);
  }

  async function saveReceive() {
    if (!selectedLocation || !venueId) return;
    setSaving(true);
    try {
      // Pre-fetch to determine which items already exist (use increment vs. set)
      const receivingLines = lines.filter(l => l.receivedQty > 0);
      const itemRefs = receivingLines.map(l =>
        doc(db, 'venues', venueId, 'departments', 'hq', 'areas', selectedLocation.id, 'items', l.productId)
      );
      const existingSnaps = await Promise.all(itemRefs.map(r => getDoc(r)));
      const existingMap = new Map(
        receivingLines.map((l, i) => [l.productId, existingSnaps[i].exists()])
      );

      const batch = writeBatch(db);
      const now = serverTimestamp();
      lines.forEach(l => {
        if (l.receivedQty <= 0) return;
        const ref = doc(db, 'venues', venueId, 'departments', 'hq', 'areas', selectedLocation.id, 'items', l.productId);
        if (existingMap.get(l.productId)) {
          // Second delivery to same location — increment, do not overwrite
          batch.update(ref, {
            lastCount: increment(l.receivedQty),
            lastCountAt: now,
            updatedAt: now,
          });
        } else {
          // First receipt — set with openingStock baseline for velocity service
          batch.set(ref, {
            name: l.productName,
            unit: 'unit',
            lastCount: l.receivedQty,
            openingStock: l.receivedQty,
            lastCountAt: now,
            createdAt: now,
            updatedAt: now,
          });
        }
      });
      if (chepEnabled && chepReceived) {
        const chepRef = doc(db, 'venues', venueId, 'departments', 'hq', 'areas', selectedLocation.id, 'items', '_chep_pallets');
        batch.set(chepRef, {
          name: 'CHEP Pallets',
          unit: 'unit',
          lastCount: parseFloat(chepReceived) || 0,
          lastCountAt: now,
          updatedAt: now,
        }, { merge: true });
      }
      // Reset distribution flag for this new receive
      const locResetRef = doc(db, 'venues', venueId, 'departments', 'hq', 'areas', selectedLocation.id);
      batch.set(locResetRef, { distributionConfirmed: false }, { merge: true });

      await batch.commit();
      setPhase('distribute');
    } catch (e: any) {
      Alert.alert('Save failed', e?.message || 'Please try again.');
    } finally {
      setSaving(false);
    }
  }

  async function saveDistribute(forceDistribute = false) {
    if (!selectedLocation || !venueId) return;
    const shortfalls = getShortfalls();
    if (shortfalls.length > 0) {
      Alert.alert(
        'Allocation exceeds received',
        `The following products are over-allocated:\n${shortfalls.map(n => `• ${n}`).join('\n')}\n\nAdjust quantities before saving.`,
        [{ text: 'OK' }]
      );
      return;
    }

    // FIX 2: Guard against double-distribution
    if (!forceDistribute && selectedLocation.distributionConfirmed) {
      Alert.alert(
        'Already distributed',
        'This delivery has already been distributed to bars. Distributing again will add to existing bar stock.\n\nAre you sure you want to continue?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Add to existing stock', style: 'destructive', onPress: () => saveDistribute(true) },
        ]
      );
      return;
    }

    setSaving(true);
    try {
      // Pre-fetch existing bar back-of-house item docs to decide increment vs. initial set
      const refsToCheck: Array<{ productId: string; barId: string; ref: any }> = [];
      for (const l of lines) {
        for (const a of (allocations[l.productId] || [])) {
          if (a.qty <= 0) continue;
          refsToCheck.push({
            productId: l.productId,
            barId: a.barId,
            ref: doc(db, 'venues', venueId, 'departments', a.barId, 'areas', 'back-of-house', 'items', l.productId),
          });
        }
      }
      const existingSnaps = await Promise.all(refsToCheck.map(r => getDoc(r.ref)));
      const existingMap = new Map<string, boolean>();
      refsToCheck.forEach((r, i) => {
        existingMap.set(`${r.productId}:${r.barId}`, existingSnaps[i].exists());
      });

      const batch = writeBatch(db);
      const now = serverTimestamp();

      for (const l of lines) {
        for (const a of (allocations[l.productId] || [])) {
          if (a.qty <= 0) continue;
          const ref = doc(db, 'venues', venueId, 'departments', a.barId, 'areas', 'back-of-house', 'items', l.productId);
          const exists = existingMap.get(`${l.productId}:${a.barId}`);
          if (exists) {
            batch.update(ref, {
              lastCount: increment(a.qty),
              lastCountAt: now,
              updatedAt: now,
            });
          } else {
            batch.set(ref, {
              name: l.productName,
              unit: 'unit',
              lastCount: a.qty,
              lastCountAt: now,
              createdAt: now,
              updatedAt: now,
            });
          }
        }

        // Deduct from HQ source location using increment
        const totalAllocated = (allocations[l.productId] || []).reduce((s, a) => s + a.qty, 0);
        if (totalAllocated > 0) {
          const srcRef = doc(db, 'venues', venueId, 'departments', 'hq', 'areas', selectedLocation.id, 'items', l.productId);
          batch.set(srcRef, {
            lastCount: increment(-totalAllocated),
            updatedAt: now,
          }, { merge: true });
        }
      }

      // Mark this location as distributed
      const locRef = doc(db, 'venues', venueId, 'departments', 'hq', 'areas', selectedLocation.id);
      batch.set(locRef, {
        distributionConfirmed: true,
        distributionConfirmedAt: now,
      }, { merge: true });

      await batch.commit();

      // FIX 3: Write each distributed product to festival product catalogue if not already there
      for (const l of lines) {
        const totalAllocated = (allocations[l.productId] || []).reduce((s, a) => s + a.qty, 0);
        if (totalAllocated <= 0) continue;
        try {
          const productRef = doc(db, 'venues', venueId, 'products', l.productId);
          const productSnap = await getDoc(productRef);
          if (!productSnap.exists()) {
            await setDoc(productRef, {
              name: l.productName,
              unit: 'unit',
              source: 'goods-in',
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }
        } catch {}
      }

      Alert.alert('Done', 'Stock allocated to bars.', [{ text: 'OK', onPress: () => nav.goBack() }]);
    } catch (e: any) {
      Alert.alert('Save failed', e?.message || 'Please try again.');
    } finally {
      setSaving(false);
    }
  }

  if (!FESTIVAL_BETA) {
    return (
      <View style={S.center}>
        <Text style={S.body}>Festival mode is not enabled.</Text>
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

  // ── Phase 1: Receive ────────────────────────────────────────────────────────
  if (phase === 'receive') {
    return (
      <ScrollView style={S.screen} contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
        <Text style={S.heading}>Goods In — Receive</Text>
        <Text style={S.sub}>Select where stock is arriving from, then enter quantities received.</Text>

        <Text style={S.label}>Source location</Text>
        {sourceLocations.length === 0 ? (
          <Text style={S.empty}>No source locations set up yet.</Text>
        ) : (
          sourceLocations.map(loc => (
            <TouchableOpacity
              key={loc.id}
              style={[S.option, selectedLocation?.id === loc.id && S.optionSelected]}
              onPress={() => setSelectedLocation(loc)}
            >
              <Text style={[S.optionText, selectedLocation?.id === loc.id && S.optionTextSelected]}>
                {loc.name}
              </Text>
            </TouchableOpacity>
          ))
        )}

        {selectedLocation && lines.length > 0 && (
          <>
            <Text style={[S.label, { marginTop: 20 }]}>Quantities received</Text>
            {lines.map(l => (
              <View key={l.productId} style={S.lineRow}>
                <View style={{ flex: 1 }}>
                  <Text style={S.lineName}>{l.productName}</Text>
                  {l.expectedQty > 0 && (
                    <Text style={S.lineSub}>Expected: {l.expectedQty}</Text>
                  )}
                </View>
                <TextInput
                  style={S.qtyInput}
                  keyboardType="numeric"
                  value={l.receivedQty > 0 ? String(l.receivedQty) : ''}
                  onChangeText={t => updateReceivedQty(l.productId, t)}
                  placeholder="0"
                  placeholderTextColor="#9ca3af"
                />
              </View>
            ))}

            <View style={S.chepRow}>
              <TouchableOpacity
                style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
                onPress={() => setChepEnabled(v => !v)}
              >
                <View style={[S.checkbox, chepEnabled && S.checkboxOn]}>
                  {chepEnabled && <Text style={S.checkmark}>✓</Text>}
                </View>
                <Text style={S.chepLabel}>CHEP pallets received</Text>
              </TouchableOpacity>
              {chepEnabled && (
                <TextInput
                  style={[S.qtyInput, { marginLeft: 'auto' }]}
                  keyboardType="numeric"
                  value={chepReceived}
                  onChangeText={setChepReceived}
                  placeholder="0"
                  placeholderTextColor="#9ca3af"
                />
              )}
            </View>

            <TouchableOpacity
              style={[S.cta, saving && S.ctaDisabled]}
              onPress={saveReceive}
              disabled={saving}
            >
              <Text style={S.ctaText}>{saving ? 'Saving…' : 'Save & distribute →'}</Text>
            </TouchableOpacity>
          </>
        )}

        {selectedLocation && lines.length === 0 && (
          <Text style={S.empty}>No products on record for this location. Add stock via the Stock Overview.</Text>
        )}
      </ScrollView>
    );
  }

  // ── Phase 2: Distribute ─────────────────────────────────────────────────────
  const shortfalls = getShortfalls();
  return (
    <ScrollView style={S.screen} contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
      <Text style={S.heading}>Goods In — Distribute</Text>
      <Text style={S.sub}>Allocate received stock to bars. Total allocated cannot exceed received.</Text>

      {shortfalls.length > 0 && (
        <View style={S.shortfallBanner}>
          <Text style={S.shortfallText}>
            ⚠ Over-allocated: {shortfalls.join(', ')}
          </Text>
        </View>
      )}

      {lines.map(l => {
        const totalAllocated = (allocations[l.productId] || []).reduce((s, a) => s + a.qty, 0);
        const remaining = l.receivedQty - totalAllocated;
        const isOver = remaining < 0;
        return (
          <View key={l.productId} style={S.productBlock}>
            <View style={S.productBlockHeader}>
              <Text style={S.lineName}>{l.productName}</Text>
              <Text style={[S.remaining, isOver && S.remainingOver]}>
                {isOver ? `${Math.abs(remaining)} over` : `${remaining} remaining`}
              </Text>
            </View>
            {bars.map(bar => (
              <View key={bar.id} style={S.lineRow}>
                <Text style={[S.lineSub, { flex: 1 }]}>{bar.name}</Text>
                <TextInput
                  style={S.qtyInput}
                  keyboardType="numeric"
                  value={
                    (allocations[l.productId] || []).find(a => a.barId === bar.id)?.qty > 0
                      ? String((allocations[l.productId] || []).find(a => a.barId === bar.id)?.qty)
                      : ''
                  }
                  onChangeText={t => updateAllocation(l.productId, bar.id, t)}
                  placeholder="0"
                  placeholderTextColor="#9ca3af"
                />
              </View>
            ))}
          </View>
        );
      })}

      <TouchableOpacity
        style={[S.cta, (saving || shortfalls.length > 0) && S.ctaDisabled]}
        onPress={() => saveDistribute()}
        disabled={saving || shortfalls.length > 0}
      >
        <Text style={S.ctaText}>{saving ? 'Saving…' : 'Confirm allocation'}</Text>
      </TouchableOpacity>

      <TouchableOpacity style={S.backBtn} onPress={() => setPhase('receive')}>
        <Text style={S.backBtnText}>← Back to receive</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const S = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f5f3ee' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f5f3ee', padding: 24 },
  heading: { fontSize: 22, fontWeight: '800', color: '#0B132B', marginBottom: 6 },
  sub: { fontSize: 14, color: '#6b7280', marginBottom: 20, lineHeight: 20 },
  label: { fontSize: 12, fontWeight: '700', color: '#9ca3af', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 8 },
  body: { fontSize: 15, color: '#6b7280', textAlign: 'center' },
  empty: { fontSize: 14, color: '#9ca3af', fontStyle: 'italic', marginTop: 8 },

  option: {
    backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: '#e5e1d8',
    paddingHorizontal: 14, paddingVertical: 12, marginBottom: 8,
  },
  optionSelected: { borderColor: '#1b4f72', backgroundColor: '#eff6ff' },
  optionText: { fontSize: 15, color: '#374151', fontWeight: '500' },
  optionTextSelected: { color: '#1b4f72', fontWeight: '700' },

  lineRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f0ede8' },
  lineName: { fontSize: 14, fontWeight: '600', color: '#0B132B' },
  lineSub: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  qtyInput: {
    width: 72, height: 40, borderRadius: 8, borderWidth: 1, borderColor: '#d1d5db',
    backgroundColor: '#fff', textAlign: 'center', fontSize: 15, fontWeight: '600', color: '#0B132B',
  },

  chepRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, marginTop: 8 },
  chepLabel: { fontSize: 14, color: '#374151', fontWeight: '500' },
  checkbox: {
    width: 22, height: 22, borderRadius: 5, borderWidth: 2, borderColor: '#d1d5db',
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff',
  },
  checkboxOn: { backgroundColor: '#1b4f72', borderColor: '#1b4f72' },
  checkmark: { color: '#fff', fontSize: 11, fontWeight: '900', lineHeight: 16 },

  productBlock: { backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#e5e1d8', padding: 14, marginBottom: 12 },
  productBlockHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  remaining: { fontSize: 12, fontWeight: '700', color: '#1b4f72' },
  remainingOver: { color: '#dc2626' },

  shortfallBanner: { backgroundColor: '#fef2f2', borderRadius: 8, padding: 10, marginBottom: 12, borderWidth: 1, borderColor: '#fca5a5' },
  shortfallText: { fontSize: 13, color: '#dc2626', fontWeight: '600' },

  cta: {
    backgroundColor: '#1b4f72', borderRadius: 12, padding: 16,
    alignItems: 'center', marginTop: 20,
  },
  ctaDisabled: { opacity: 0.5 },
  ctaText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  backBtn: { alignItems: 'center', marginTop: 12, paddingVertical: 8 },
  backBtnText: { fontSize: 14, color: '#6b7280', fontWeight: '500' },
});
