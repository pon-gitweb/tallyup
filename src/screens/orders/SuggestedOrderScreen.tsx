import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, FlatList, Modal, Text, TextInput, TouchableOpacity, View, SafeAreaView, ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { getAuth } from 'firebase/auth';

import {
  buildSuggestedOrdersInMemory,
  createDraftsFromSuggestions,
  type SuggestedLegacyMap,
  type SuggestedLine,
  listSuppliers,
  setParSmart,
  setSupplierSmart,
  type Supplier,
  type CreateDraftsResult,
} from '../../services/orders';
import { useVenueId } from '../../context/VenueProvider';

const aliasKeys = new Set(['unassigned','__no_supplier__','no_supplier','none','null','undefined','']);

type UIGroup = { key: string; title: string; lines: SuggestedLine[]; isUnassigned: boolean; };

function coerceLines(bucket: any): SuggestedLine[] {
  if (!bucket || typeof bucket !== 'object') return [];
  if (Array.isArray(bucket.lines)) return bucket.lines as SuggestedLine[];
  if (bucket.items && typeof bucket.items === 'object') return Object.values(bucket.items) as SuggestedLine[];
  return Object.values(bucket).filter((v: any) => v && typeof v === 'object' && 'productId' in v) as SuggestedLine[];
}

function hasRouteNamed(state: any, name: string): boolean {
  if (!state) return false;
  if (Array.isArray((state as any).routeNames) && (state as any).routeNames.includes(name)) return true;
  if (Array.isArray(state.routes)) {
    return state.routes.some((r: any) => r.name === name || hasRouteNamed(r.state, name));
  }
  return false;
}

export default function SuggestedOrderScreen() {
  const nav = useNavigation<any>();
  const venueId = useVenueId();
  const uid = getAuth().currentUser?.uid ?? null;

  const [loading, setLoading] = useState(true);
  const [roundToPack, setRoundToPack] = useState(true);
  const [data, setData] = useState<SuggestedLegacyMap | null>(null);

  const [supplierModalOpen, setSupplierModalOpen] = useState(false);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierPickTarget, setSupplierPickTarget] = useState<{ productId: string; productName?: string | null } | null>(null);

  const [parModalOpen, setParModalOpen] = useState(false);
  const [parTarget, setParTarget] = useState<{ productId: string; productName?: string | null } | null>(null);
  const [parInput, setParInput] = useState<string>('');

  const [guardBanner, setGuardBanner] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const s = await buildSuggestedOrdersInMemory(venueId!, { roundToPack, defaultParIfMissing: 6 });
      setData(s);
    } catch (e: any) {
      console.log('[SuggestedOrders] load error', e?.message || e);
      Alert.alert('Suggestions', e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [venueId, roundToPack]);

  useEffect(() => { load(); }, [load]);

  const groups: UIGroup[] = useMemo(() => {
    if (!data) return [];
    const seen = new Set<any>();
    const uniq: Array<{ key: string; bucket: any }> = [];
    for (const key of Object.keys(data)) {
      const bucket = (data as any)[key];
      if (!bucket) continue;
      if (seen.has(bucket)) continue;
      seen.add(bucket);
      uniq.push({ key, bucket });
    }
    const out: UIGroup[] = [];
    uniq.forEach(({ key, bucket }) => {
      const lines = coerceLines(bucket);
      if (!lines.length) return;
      const isUnassigned = aliasKeys.has(key);
      out.push({ key: isUnassigned ? 'unassigned' : key, title: isUnassigned ? 'Unassigned' : key, lines, isUnassigned });
    });
    out.sort((a, b) => (a.isUnassigned === b.isUnassigned ? a.title.localeCompare(b.title) : (a.isUnassigned ? -1 : 1)));
    return out;
  }, [data]);

  const openSupplierPicker = useCallback(async (productId: string, productName?: string | null) => {
    try {
      const rows = await listSuppliers(venueId!);
      setSuppliers(rows);
      setSupplierPickTarget({ productId, productName });
      setSupplierModalOpen(true);
    } catch (e: any) {
      Alert.alert('Failed to load suppliers', e?.message ?? String(e));
    }
  }, [venueId]);

  const pickSupplier = useCallback(async (supplier: Supplier) => {
    if (!venueId || !supplierPickTarget) return;
    try {
      await setSupplierSmart(venueId, supplierPickTarget.productId, supplier.id, supplier.name ?? undefined);
      setSupplierModalOpen(false);
      setSupplierPickTarget(null);
      await load();
      Alert.alert('Supplier set', `Linked ${supplierPickTarget.productName ?? 'item'} to ${supplier.name ?? supplier.id}.`);
    } catch (e: any) {
      Alert.alert('Update failed', e?.message ?? String(e));
    }
  }, [venueId, supplierPickTarget, load]);

  const openParEditor = useCallback((productId: string, suggestedQty: number, productName?: string | null) => {
    setParTarget({ productId, productName });
    setParInput(String(Math.max(1, Math.floor(suggestedQty))));
    setParModalOpen(true);
  }, []);

  const savePar = useCallback(async () => {
    if (!venueId || !parTarget) return;
    const n = Number(parInput);
    if (!Number.isFinite(n) || n <= 0) return Alert.alert('Invalid PAR', 'Enter a positive number.');
    try {
      await setParSmart(venueId, parTarget.productId, Math.floor(n));
      setParModalOpen(false);
      setParTarget(null);
      await load();
      Alert.alert('PAR saved', `PAR set to ${Math.floor(n)} for ${parTarget.productName ?? parTarget.productId}.`);
    } catch (e: any) {
      Alert.alert('Update failed', e?.message ?? String(e));
    }
  }, [venueId, parTarget, parInput, load]);

  const goToOrders = useCallback(() => {
    const state = (nav as any).getState?.();
    const candidates: Array<{ name: string; params?: any }> = [
      { name: 'Orders' },
      { name: 'OrdersScreen' },
      { name: 'Main', params: { screen: 'Orders' } },
      { name: 'OrdersTab' },
      { name: 'OrdersList' },
    ];

    for (const p of candidates) {
      if (!state || hasRouteNamed(state, p.name)) {
        // @ts-ignore
        nav.navigate(p.name as never, (p.params ?? undefined) as never);
        return;
      }
    }
    Alert.alert('Navigate', 'Could not find Orders screen in navigator.');
  }, [nav]);

  const createDrafts = useCallback(async () => {
    try {
      setGuardBanner(null);
      if (!data) return;
      const res: CreateDraftsResult = await createDraftsFromSuggestions(venueId!, data, { createdBy: uid });
      if (res.skippedByGuard) {
        setGuardBanner('Drafts already created recently for this cycle. No new drafts were made.');
        return;
      }
      if (res.created.length === 0) {
        Alert.alert('No drafts created', 'No suggestion lines were available.');
      } else {
        Alert.alert('Drafts created', `Created ${res.created.length} draft order(s).`, [
          { text: 'View Orders', onPress: () => goToOrders() },
          { text: 'OK' },
        ]);
      }
    } catch (e: any) {
      Alert.alert('Create drafts failed', e?.message ?? String(e));
    }
  }, [venueId, data, uid, goToOrders]);

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" />
        <Text style={{ marginTop: 8 }}>Building suggestions…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8, borderBottomWidth: 1, borderColor: '#eee' }}>
        <Text style={{ fontSize: 18, fontWeight: '600' }}>Suggested Orders</Text>
        {guardBanner ? <Text style={{ color: '#a60', marginTop: 6 }}>{guardBanner}</Text> : null}
        <View style={{ flexDirection: 'row', marginTop: 8 }}>
          <TouchableOpacity onPress={load} style={{ paddingVertical: 8, paddingHorizontal: 12, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, marginRight: 8 }}>
            <Text>Refresh</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setRoundToPack(x => !x)} style={{ paddingVertical: 8, paddingHorizontal: 12, borderWidth: 1, borderColor: '#ddd', borderRadius: 8 }}>
            <Text>{roundToPack ? 'Round to pack: ON' : 'Round to pack: OFF'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        data={groups}
        keyExtractor={(g) => g.key}
        contentContainerStyle={{ paddingBottom: 96 }}
        renderItem={({ item: g }) => (
          <View style={{ marginHorizontal: 16, marginTop: 12, borderWidth: 1, borderColor: '#eee', borderRadius: 12, overflow: 'hidden' }}>
            <View style={{ padding: 12, backgroundColor: '#fafafa', borderBottomWidth: 1, borderColor: '#eee' }}>
              <Text style={{ fontWeight: '600' }}>{g.title}</Text>
              {g.isUnassigned ? <Text style={{ color: '#c00', marginTop: 2 }}>Some items need a supplier</Text> : null}
            </View>
            {g.lines.map((ln) => (
              <View key={ln.productId} style={{ padding: 12, borderTopWidth: 1, borderColor: '#f2f2f2' }}>
                <Text style={{ fontWeight: '500' }}>{ln.productName ?? ln.productId}</Text>
                <Text style={{ marginTop: 2 }}>Qty: {ln.qty}</Text>
                {ln.needsPar ? <Text style={{ color: '#d47a00' }}>Needs PAR</Text> : null}
                {ln.needsSupplier ? <Text style={{ color: '#d47a00' }}>Needs supplier</Text> : null}
                <View style={{ flexDirection: 'row', marginTop: 8 }}>
                  <TouchableOpacity onPress={() => openParEditor(ln.productId, ln.qty, ln.productName)} style={{ paddingVertical: 6, paddingHorizontal: 10, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, marginRight: 8 }}>
                    <Text>Set PAR</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => openSupplierPicker(ln.productId, ln.productName)} style={{ paddingVertical: 6, paddingHorizontal: 10, borderWidth: 1, borderColor: '#ddd', borderRadius: 8 }}>
                    <Text>Set supplier</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        )}
        ListEmptyComponent={<View style={{ padding: 24 }}><Text>No suggestions yet. Try taking a stock count, then Refresh.</Text></View>}
      />

      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 12, backgroundColor: '#fff', borderTopWidth: 1, borderColor: '#eee' }}>
        <TouchableOpacity onPress={createDrafts} style={{ backgroundColor: '#0a7', paddingVertical: 14, borderRadius: 10, alignItems: 'center' }}>
          <Text style={{ color: '#fff', fontWeight: '700' }}>Create drafts</Text>
        </TouchableOpacity>
      </View>

      {/* Supplier modal */}
      <Modal visible={supplierModalOpen} transparent animationType="fade" onRequestClose={() => setSupplierModalOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'center', padding: 24 }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 12, padding: 16, maxHeight: '70%' }}>
            <Text style={{ fontWeight: '700', fontSize: 16 }}>Pick supplier</Text>
            <FlatList
              style={{ marginTop: 8 }}
              data={suppliers}
              keyExtractor={(s) => s.id}
              renderItem={({ item }) => (
                <TouchableOpacity onPress={() => pickSupplier(item)} style={{ paddingVertical: 10 }}>
                  <Text>{item.name ?? item.id}</Text>
                </TouchableOpacity>
              )}
              ListEmptyComponent={<Text style={{ paddingVertical: 8 }}>No suppliers yet.</Text>}
            />
            <TouchableOpacity onPress={() => setSupplierModalOpen(false)} style={{ alignSelf: 'flex-end', paddingVertical: 10 }}>
              <Text>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* PAR modal */}
      <Modal visible={parModalOpen} transparent animationType="fade" onRequestClose={() => setParModalOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'center', padding: 24 }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 12, padding: 16 }}>
            <Text style={{ fontWeight: '700', fontSize: 16 }}>Set PAR</Text>
            <TextInput
              style={{ marginTop: 10, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, paddingHorizontal: 10, height: 40 }}
              keyboardType="number-pad"
              value={parInput}
              onChangeText={setParInput}
              placeholder="Enter PAR"
            />
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12 }}>
              <TouchableOpacity onPress={() => setParModalOpen(false)} style={{ padding: 10, marginRight: 8 }}>
                <Text>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={savePar} style={{ padding: 10 }}>
                <Text style={{ color: '#0a7', fontWeight: '600' }}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
