import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Alert, FlatList, Text, TouchableOpacity, View, SafeAreaView, ActivityIndicator, TextInput } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { getFirestore, collection, getDocs, query, where } from 'firebase/firestore';

import {
  buildSuggestedOrdersInMemory,
  createDraftsFromSuggestions,
  listSuppliers as listSuppliersFromBarrel,
  setParOnProduct as setParOnProductFromBarrel,
  setSupplierOnProduct as setSupplierOnProductFromBarrel,
} from '../../services/orders';
import { useVenueId } from '../../context/VenueProvider';

/** Types mirror your suggest.ts output */
type SuggestedLineRaw = {
  productId: string;
  productName?: string | null;
  qty: number;
  cost?: number;
  supplierId?: string | null;
  reason?: string | null;
};
type CompatBucket = {
  items: Record<string, SuggestedLineRaw>;
  lines: SuggestedLineRaw[];
  [pid: string]: any; // compat surface
};
type SuggestedLegacyMap = Record<string, CompatBucket>;

type SuggestedLine = {
  productId: string;
  qty: number;
  cost?: number;
  supplierId?: string | null;
  name?: string;
  reason?: string | null;
};
type Supplier = { id: string; name?: string | null; active?: boolean | null };

const isArray = Array.isArray;
const toNum = (v: any, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const hasId = (x: unknown): x is string => typeof x === 'string' && x.length > 0;

/** Flatten the compat map into a single raw lines list, deduping alias buckets */
function flattenCompatLines(compat: SuggestedLegacyMap): SuggestedLineRaw[] {
  const seen = new Set<CompatBucket>();
  const out: SuggestedLineRaw[] = [];
  for (const key of Object.keys(compat)) {
    const b = compat[key];
    if (!b || typeof b !== 'object') continue;
    if (seen.has(b)) continue;       // many supplier aliases point to same bucket
    seen.add(b);
    if (isArray(b.lines)) out.push(...b.lines);
  }
  return out;
}

/** Aggregate duplicates by productId (sum qty, keep first defined cost/supplier/name/reason) */
function aggregateByProduct(list: SuggestedLine[]): SuggestedLine[] {
  const m = new Map<string, SuggestedLine>();
  for (const l of list) {
    const cur = m.get(l.productId);
    if (!cur) {
      m.set(l.productId, { ...l });
    } else {
      cur.qty = toNum(cur.qty, 0) + toNum(l.qty, 0);
      if (cur.cost == null && l.cost != null) cur.cost = l.cost;
      if (!cur.supplierId && l.supplierId) cur.supplierId = l.supplierId;
      if (!cur.name && l.name) cur.name = l.name;
      if (!cur.reason && l.reason) cur.reason = l.reason;
    }
  }
  return [...m.values()];
}

async function loadProductsMap(venueId: string): Promise<Record<string, { name?: string }>> {
  const db = getFirestore();
  const out: Record<string, { name?: string }> = {};
  try {
    const snap = await getDocs(collection(db, 'venues', venueId, 'products'));
    snap.forEach(doc => { const d = doc.data() as any; out[doc.id] = { name: d?.name ?? d?.title ?? undefined }; });
  } catch {}
  if (Object.keys(out).length === 0) {
    try {
      const snap = await getDocs(query(collection(db, 'products'), where('venueId', '==', venueId)));
      snap.forEach(doc => { const d = doc.data() as any; out[doc.id] = { name: d?.name ?? d?.title ?? undefined }; });
    } catch {}
  }
  return out;
}

export default function SuggestedOrderScreen() {
  const nav = useNavigation<NativeStackNavigationProp<any>>();
  const venueId = useVenueId();

  const [loading, setLoading] = useState(true);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [lines, setLines] = useState<SuggestedLine[]>([]);
  const [rawCount, setRawCount] = useState(0);
  const [creating, setCreating] = useState(false);
  const [bulkSupplierId, setBulkSupplierId] = useState<string | null>(null);

  const listSuppliers = listSuppliersFromBarrel;
  const setParOnProduct = setParOnProductFromBarrel;
  const setSupplierOnProduct = setSupplierOnProductFromBarrel;

  const load = useCallback(async () => {
    try {
      if (!venueId) throw new Error('No venue selected');
      setLoading(true);

      const sups = await listSuppliers(venueId);
      setSuppliers(sups ?? []);

      // Build compat (supplierId -> bucket with .lines[])
      const compat = await buildSuggestedOrdersInMemory(venueId) as unknown as SuggestedLegacyMap;

      // Flatten all buckets' lines (dedupe alias buckets)
      const rawLines = flattenCompatLines(compat);
      setRawCount(rawLines.length);

      // Canonicalize → SuggestedLine
      const canon: SuggestedLine[] = rawLines
        .filter((r) => hasId(r?.productId))
        .map((r) => ({
          productId: r.productId,
          qty: toNum(r.qty, 0),
          cost: Number.isFinite(Number(r.cost)) ? Number(r.cost) : undefined,
          supplierId: r.supplierId ?? null,
          name: r.productName ?? undefined,
          reason: r.reason ?? null,
        }));

      // Aggregate across areas → one line per product
      let agg = aggregateByProduct(canon);

      // Hydrate names from products if missing
      const prodMap = await loadProductsMap(venueId);
      agg = agg.map(l => ({ ...l, name: l.name ?? prodMap[l.productId]?.name ?? l.productId }));

      setLines(agg);

      console.log('[SuggestedOrders] load summary', {
        raw: rawLines.length, aggregated: agg.length,
      });
    } catch (e: any) {
      console.warn('[SuggestedOrderScreen] load failed', e);
      Alert.alert('Suggested Orders', e?.message ?? 'Failed to load suggestions.');
    } finally {
      setLoading(false);
    }
  }, [venueId]);

  useEffect(() => { load(); }, [load]);

  const unassigned = useMemo(() => lines.filter(l => !l.supplierId), [lines]);
  const totalQty = useMemo(() => lines.reduce((a, l) => a + toNum(l.qty, 0), 0), [lines]);

  const applyBulkSupplier = useCallback(() => {
    if (!bulkSupplierId) return;
    setLines(prev => prev.map(l => (l.supplierId ? l : { ...l, supplierId: bulkSupplierId })));
  }, [bulkSupplierId]);

  const saveAssignments = useCallback(async () => {
    try {
      if (!venueId) throw new Error('No venue selected');
      const toSave = lines.filter(l => l.supplierId && hasId(l.productId));
      if (toSave.length === 0) {
        Alert.alert('Assign Suppliers', 'No assigned lines to save.');
        return;
      }
      for (const l of toSave) {
        await setSupplierOnProduct(venueId, l.productId, l.supplierId as string);
      }
      Alert.alert('Assign Suppliers', 'Saved default suppliers on products.');
    } catch (e: any) {
      console.warn('[SuggestedOrderScreen] saveAssignments failed', e);
      Alert.alert('Assign Suppliers', e?.message ?? 'Failed to save assignments.');
    }
  }, [venueId, lines, setSupplierOnProduct]);

  const updatePar = useCallback(async (productId: string, parStr: string) => {
    try {
      if (!venueId) throw new Error('No venue selected');
      if (!hasId(productId)) {
        Alert.alert('Set Par', 'This row has no product ID and cannot be updated.');
        return;
      }
      const n = Number(String(parStr ?? '').trim());
      if (!Number.isFinite(n) || n < 0) {
        Alert.alert('Set Par', 'Enter a non-negative number.');
        return;
      }
      await setParOnProduct(venueId, productId, n);
      Alert.alert('Set Par', 'Par updated.');
    } catch (e: any) {
      console.warn('[SuggestedOrderScreen] setPar failed', e);
      Alert.alert('Set Par', e?.message ?? 'Failed to set par.');
    }
  }, [venueId, setParOnProduct]);

  const onCreateDrafts = useCallback(async () => {
    try {
      if (!venueId) throw new Error('No venue selected');
      if (lines.length === 0) {
        Alert.alert('Suggested Orders', 'No lines to create.');
        return;
      }
      const validAssigned = lines.filter(l => hasId(l.productId) && l.supplierId);
      if (validAssigned.length === 0) {
        Alert.alert('No Supplier Assigned', 'Assign suppliers first, then create drafts.');
        return;
      }

      const grouped: Record<string, SuggestedLine[]> = {};
      for (const l of validAssigned) {
        const k = l.supplierId as string;
        (grouped[k] ??= []).push(l);
      }

      let createdIds: string[] = [];
      setCreating(true);
      for (const sid of Object.keys(grouped)) {
        const bucket = grouped[sid]!;
        const ids = await createDraftsFromSuggestions(venueId, bucket as any);
        if (Array.isArray(ids)) createdIds.push(...ids);
        else if (typeof ids === 'string') createdIds.push(ids);
      }

      if (createdIds.length === 0) {
        Alert.alert('Suggested Orders', 'No drafts were created. Check assignments.');
        return;
      }
      Alert.alert('Created', `Created ${createdIds.length} draft order${createdIds.length === 1 ? '' : 's'}.`);
    } catch (e: any) {
      console.warn('[SuggestedOrderScreen] createDrafts failed', e);
      Alert.alert('Create Drafts', e?.message ?? 'Failed to create drafts.');
    } finally {
      setCreating(false);
    }
  }, [venueId, lines]);

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
        <Text style={{ marginTop: 8 }}>Loading suggestions…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, padding: 16 }}>
      <View style={{ marginBottom: 8 }}>
        <Text style={{ fontSize: 18, fontWeight: '600' }}>Suggested Orders</Text>
        <Text style={{ color: '#666', marginTop: 2 }}>
          Aggregated {rawCount} rows into {lines.length} products
        </Text>
      </View>

      {unassigned.length > 0 ? (
        <View style={{ backgroundColor: '#fff4e5', borderColor: '#f0ad4e', borderWidth: 1, padding: 10, borderRadius: 8, marginBottom: 10 }}>
          <Text style={{ color: '#8a6d3b', marginBottom: 8 }}>
            {unassigned.length} product(s) have no supplier.
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={{ marginRight: 8 }}>Assign all to:</Text>
            <FlatList
              data={suppliers}
              horizontal
              keyExtractor={(s) => s.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  onPress={() => setBulkSupplierId(item.id)}
                  style={{
                    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
                    borderWidth: 1, borderColor: bulkSupplierId === item.id ? '#222' : '#ccc',
                    marginRight: 8
                  }}
                >
                  <Text>{item.name ?? item.id}</Text>
                </TouchableOpacity>
              )}
            />
            <TouchableOpacity onPress={applyBulkSupplier} disabled={!bulkSupplierId}
              style={{ paddingHorizontal: 12, paddingVertical: 8, backgroundColor: bulkSupplierId ? '#222' : '#ccc', borderRadius: 10 }}>
              <Text style={{ color: '#fff' }}>Apply</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={saveAssignments}
              style={{ paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#222', borderRadius: 10, marginLeft: 8 }}>
              <Text style={{ color: '#fff' }}>Save defaults</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      <FlatList
        data={lines}
        keyExtractor={(item, index) => `${item.productId}-${index}`}
        renderItem={({ item, index }) => (
          <View style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#eee' }}>
            <Text style={{ fontWeight: '600' }}>{item.name ?? item.productId}</Text>
            <Text>Qty: {item.qty}</Text>
            <Text>Supplier: {item.supplierId ?? '(unassigned)'}</Text>

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 }}>
              {suppliers.map(s => (
                <TouchableOpacity
                  key={`${item.productId}-${s.id}`}
                  onPress={() => setLines(prev => prev.map((l, i) => i === index ? { ...l, supplierId: s.id } : l))}
                  style={{
                    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
                    borderWidth: 1, borderColor: item.supplierId === s.id ? '#222' : '#ccc',
                    marginRight: 8, marginBottom: 6
                  }}
                >
                  <Text>{s.name ?? s.id}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
              <Text style={{ marginRight: 8 }}>Set Par:</Text>
              <TextInput
                placeholder="e.g. 12"
                keyboardType="numeric"
                style={{ borderWidth: 1, borderColor: '#ccc', paddingHorizontal: 8, paddingVertical: 6, borderRadius: 6, minWidth: 70, marginRight: 8 }}
                onSubmitEditing={(e) => updatePar(item.productId, e.nativeEvent.text)}
              />
              <Text style={{ color: '#777' }}>(press return to save)</Text>
            </View>
          </View>
        )}
      />

      <TouchableOpacity
        onPress={onCreateDrafts}
        disabled={creating || lines.length === 0}
        style={{
          backgroundColor: creating || lines.length === 0 ? '#ccc' : '#222',
          padding: 14,
          borderRadius: 12,
          alignItems: 'center',
          marginTop: 16,
        }}
      >
        <Text style={{ color: '#fff', fontWeight: '600' }}>
          {creating ? 'Creating…' : `Create Draft${lines.length > 1 ? 's' : ''} (${totalQty} items)`}
        </Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}
