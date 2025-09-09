import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  SafeAreaView,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { getApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  collectionGroup,
  getDocs,
  addDoc,
  doc,
  setDoc,
  updateDoc,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';

import {
  buildSuggestedOrdersInMemory,
  listSuppliers,
  // optional helper in your services; not required by this screen now:
  // createDraftsFromSuggestions,
} from 'src/services/orders';

import { useVenueId } from 'src/context/VenueProvider';

/* ----------------------------- local types ----------------------------- */

type Supplier = { id: string; name?: string | null };

type SuggestedLine = {
  productId: string;
  productName?: string | null;
  qty: number;       // computed suggestion
  cost: number;      // unit cost if available
  needsPar?: boolean;
  needsSupplier?: boolean;
  reason?: string | null;
};

type CompatBucket = { items: Record<string, SuggestedLine>; lines: SuggestedLine[] };

/* Picker modals */
type PickerState = {
  visible: boolean;
  bucketKey: string | null;   // if set => assign to whole bucket
  productId: string | null;   // if set => assign just that item
  productName?: string | null;
};

type ParEditorState = {
  visible: boolean;
  productId: string | null;
  productName?: string | null;
  value: string;
};

/* --------------------------- local helpers (UI) -------------------------- */

function Chip(props: { title: string; onPress?(): void }) {
  return (
    <TouchableOpacity onPress={props.onPress}>
      <Text
        style={{
          paddingHorizontal: 10,
          paddingVertical: 6,
          backgroundColor: '#f2f2f2',
          borderRadius: 8,
          marginRight: 8,
          marginBottom: 8,
        }}
      >
        {props.title}
      </Text>
    </TouchableOpacity>
  );
}

/* ------------------------ data helpers (firestore) ----------------------- */

/** Ensure a product doc exists (so subsequent merges succeed) */
async function ensureProductIfMissing(
  venueId: string,
  productId: string,
  nameHint?: string | null
) {
  const db = getFirestore(getApp());
  await setDoc(
    doc(db, 'venues', venueId, 'products', productId),
    { name: nameHint ?? productId, updatedAt: serverTimestamp() },
    { merge: true }
  );
}

/**
 * Link orphan area items (no productId) to a canonical product.
 * Heuristic: match by (doc.id === productId) or (name === nameHint).
 * Optionally copy supplier onto the item for immediate re-bucketing on next load.
 */
async function linkAreaItemsToProduct(
  venueId: string,
  productId: string,
  nameHint?: string | null,
  copySupplier?: { supplierId?: string | null; supplierName?: string | null }
) {
  const db = getFirestore(getApp());

  const deps = await getDocs(collection(db, 'venues', venueId, 'departments'));
  for (const dep of deps.docs) {
    const areas = await getDocs(
      collection(db, 'venues', venueId, 'departments', dep.id, 'areas')
    );
    for (const area of areas.docs) {
      const items = await getDocs(
        collection(
          db,
          'venues',
          venueId,
          'departments',
          dep.id,
          'areas',
          area.id,
          'items'
        )
      );

      for (const it of items.docs) {
        const data = it.data() as any;
        const hasLink = !!(data?.productId || data?.productRef?.id || data?.product?.id);
        if (hasLink) continue;

        const idMatch = it.id === productId;
        const nameMatch = (data?.name ?? data?.productName ?? '') === (nameHint ?? productId);

        if (idMatch || nameMatch) {
          const ref = doc(
            db,
            'venues',
            venueId,
            'departments',
            dep.id,
            'areas',
            area.id,
            'items',
            it.id
          );
          const update: any = { productId, updatedAt: serverTimestamp() };
          if (copySupplier?.supplierId) update.supplierId = copySupplier.supplierId;
          if (copySupplier?.supplierName) update.supplierName = copySupplier.supplierName;

          console.log('[linkAreaItemsToProduct] linking', { path: ref.path, to: productId });
          await updateDoc(ref, update);
        }
      }
    }
  }
}

// REMOVE the collectionGroup version and use this instead
async function fetchLastStockTakeCompletedAt(venueId: string): Promise<Timestamp | null> {
  const db = getFirestore(getApp());
  let latest: Timestamp | null = null;

  const deps = await getDocs(collection(db, 'venues', venueId, 'departments'));
  for (const dep of deps.docs) {
    const areas = await getDocs(
      collection(db, 'venues', venueId, 'departments', dep.id, 'areas')
    );
    for (const a of areas.docs) {
      const data = a.data() as any;
      const comp = data?.completedAt as Timestamp | undefined;
      if (comp && (!latest || comp.toMillis() > latest.toMillis())) {
        latest = comp;
      }
    }
  }
  return latest;
}


/* ------------------------------ main screen ----------------------------- */

export default function SuggestedOrderScreen() {
  const venueId = useVenueId();
  const nav = useNavigation<any>();

  const [loading, setLoading] = useState(false);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [buckets, setBuckets] = useState<Record<string, CompatBucket>>({});
  const [picker, setPicker] = useState<PickerState>({
    visible: false,
    bucketKey: null,
    productId: null,
    productName: null,
  });
  const [parEditor, setParEditor] = useState<ParEditorState>({
    visible: false,
    productId: null,
    productName: null,
    value: '',
  });

  const [draftedSupplierIds, setDraftedSupplierIds] = useState<Record<string, true>>({});
  const [lastCompletedAt, setLastCompletedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!venueId) return;
    setLoading(true);
    try {
      const compat = await buildSuggestedOrdersInMemory(venueId, {
        roundToPack: true,
        defaultParIfMissing: 6,
      });
      setBuckets(compat);

      const ss = await listSuppliers(venueId);
      setSuppliers(ss);

      // last completed stock-take banner
      const ts = await fetchLastStockTakeCompletedAt(venueId);
      setLastCompletedAt(ts ? new Date(ts.toMillis()).toLocaleString() : null);

      const vals = Object.values(compat);
      console.log('[SuggestedOrders] load summary', {
        raw: vals.length,
        aggregated: new Set(vals).size,
      });
    } catch (e) {
      console.warn('[SuggestedOrders] load failed', e);
      Alert.alert('Suggested Orders', 'Failed to load suggestions.');
    } finally {
      setLoading(false);
    }
  }, [venueId]);

  useEffect(() => {
    load();
  }, [load]);

  /** Deduplicate alias keys so each CompatBucket renders once. */
  const uniqueBuckets = useMemo(() => {
    const seen = new WeakSet<object>();
    const out: Array<{ key: string; bucket: CompatBucket }> = [];
    for (const [k, b] of Object.entries(buckets)) {
      if (!b || typeof b !== 'object') continue;
      if ((b.lines?.length ?? 0) === 0) continue;
      if (seen.has(b as object)) continue;
      seen.add(b as object);
      out.push({ key: k, bucket: b });
    }
    return out;
  }, [buckets]);

  /* ---------------------------- write operations ---------------------------- */

  const updatePar = useCallback(
    async (productId: string, parStr: string, nameHint?: string | null) => {
      try {
        if (!venueId) throw new Error('No venue selected');
        const n = Number(String(parStr ?? '').trim());
        if (!Number.isFinite(n) || n < 0) {
          Alert.alert('Set PAR', 'Enter a non-negative number.');
          return;
        }

        await ensureProductIfMissing(venueId, productId, nameHint ?? productId);
        await linkAreaItemsToProduct(venueId, productId, nameHint ?? productId);

        const db = getFirestore(getApp());
        const pref = doc(db, 'venues', venueId, 'products', productId);
        console.log('[updatePar] writing', { path: pref.path, par: n });
        await setDoc(
          pref,
          { par: n, parLevel: n, updatedAt: serverTimestamp() },
          { merge: true }
        );

        Alert.alert('Set PAR', 'Par updated.');
        await load();
      } catch (e: any) {
        console.warn('[SuggestedOrderScreen] setPar failed', { code: e?.code, msg: e?.message });
        Alert.alert('Set PAR', `[${e?.code ?? 'unknown'}] ${e?.message ?? 'Failed to set PAR.'}`);
      }
    },
    [venueId, load]
  );

  const assignSupplierGroup = useCallback(
    async (bucket: CompatBucket, supplierId: string) => {
      try {
        if (!venueId) throw new Error('No venue selected');
        const db = getFirestore(getApp());
        const supplierName = suppliers.find((s) => s.id === supplierId)?.name ?? null;

        for (const line of bucket.lines) {
          const pid = line.productId;
          if (!pid) continue;

          await ensureProductIfMissing(venueId, pid, line.productName ?? pid);
          await linkAreaItemsToProduct(venueId, pid, line.productName ?? pid, {
            supplierId,
            supplierName,
          });

          const pref = doc(db, 'venues', venueId, 'products', pid);
          console.log('[assignSupplier:group] writing', { path: pref.path, supplierId });
          await setDoc(
            pref,
            { supplierId, supplierName, updatedAt: serverTimestamp() },
            { merge: true }
          );
        }

        Alert.alert('Supplier', 'Supplier assigned to all items in this group.');
        setPicker({ visible: false, bucketKey: null, productId: null, productName: null });
        await load();
      } catch (e: any) {
        console.warn('[SuggestedOrderScreen] setSupplier (group) failed', {
          code: e?.code,
          msg: e?.message,
        });
        Alert.alert(
          'Supplier',
          `[${e?.code ?? 'unknown'}] ${e?.message ?? 'Failed to set supplier.'}`
        );
      }
    },
    [venueId, suppliers, load]
  );

  const assignSupplierOne = useCallback(
    async (productId: string, productName: string | null | undefined, supplierId: string) => {
      try {
        if (!venueId) throw new Error('No venue selected');
        const db = getFirestore(getApp());
        const supplierName = suppliers.find((s) => s.id === supplierId)?.name ?? null;

        await ensureProductIfMissing(venueId, productId, productName ?? productId);
        await linkAreaItemsToProduct(venueId, productId, productName ?? productId, {
          supplierId,
          supplierName,
        });

        const pref = doc(db, 'venues', venueId, 'products', productId);
        console.log('[assignSupplier:item] writing', { path: pref.path, supplierId });
        await setDoc(
          pref,
          { supplierId, supplierName, updatedAt: serverTimestamp() },
          { merge: true }
        );

        setPicker({ visible: false, bucketKey: null, productId: null, productName: null });
        await load();
      } catch (e: any) {
        console.warn('[SuggestedOrderScreen] setSupplier (one) failed', {
          code: e?.code,
          msg: e?.message,
        });
        Alert.alert(
          'Supplier',
          `[${e?.code ?? 'unknown'}] ${e?.message ?? 'Failed to set supplier.'}`
        );
      }
    },
    [venueId, suppliers, load]
  );

  /* ------------------------- create DRAFTS from UI ------------------------- */

  /** Create one draft order for a given supplier bucket. */
  const createDraftForBucket = useCallback(
    async (bucketKey: string) => {
      if (!venueId) return;
      if (!bucketKey || bucketKey === 'unassigned') {
        Alert.alert('Create Draft', 'Assign a supplier first.');
        return;
      }
      const bucket = buckets[bucketKey];
      if (!bucket || bucket.lines.length === 0) return;

      const supplierName = suppliers.find((s) => s.id === bucketKey)?.name ?? null;

      try {
        const db = getFirestore(getApp());

        // Create order header
        const orderRef = await addDoc(collection(db, 'venues', venueId, 'orders'), {
          status: 'draft',
          supplierId: bucketKey,
          supplierName,
          lineCount: bucket.lines.length,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          createdFrom: {
            type: 'suggestions',
            stockTakeCompletedAt: lastCompletedAt ?? null,
          },
        });

        // Add lines
        for (const line of bucket.lines) {
          await addDoc(collection(orderRef, 'lines'), {
            productId: line.productId,
            productName: line.productName ?? line.productId,
            qty: line.qty,
            unitCost: line.cost ?? null,
            reason: line.reason ?? null,
            createdAt: serverTimestamp(),
          });
        }

        setDraftedSupplierIds((s) => ({ ...s, [bucketKey]: true }));
        Alert.alert('Draft created', `Draft order for ${supplierName ?? bucketKey} created.`);
      } catch (e: any) {
        console.warn('[SuggestedOrderScreen] createDraftForBucket failed', e);
        Alert.alert('Draft', e?.message ?? 'Failed to create draft.');
      }
    },
    [venueId, buckets, suppliers, lastCompletedAt]
  );

  /** Create drafts for ALL visible supplier buckets (skip "unassigned"). */
  const createDraftsAllVisible = useCallback(async () => {
    for (const { key } of uniqueBuckets) {
      if (key && key !== 'unassigned') {
        // eslint-disable-next-line no-await-in-loop
        await createDraftForBucket(key);
      }
    }
    Alert.alert('Drafts', 'Drafts created for all visible suppliers. Go to Orders to finalise.');
  }, [uniqueBuckets, createDraftForBucket]);

  /* ------------------------------ rendering ------------------------------ */

  const renderLine = (line: SuggestedLine) => {
    const pid = line.productId;
    const pname = line.productName ?? pid;

    return (
      <View
        key={pid || `${pname}-${Math.random().toString(36).slice(2)}`}
        style={{ paddingVertical: 10, borderTopWidth: 0.5, borderColor: '#eee' }}
      >
        <Text style={{ fontWeight: '600' }}>{pname}</Text>

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            marginTop: 6,
            flexWrap: 'wrap',
          }}
        >
          <Chip title="Set PAR 6" onPress={() => updatePar(pid, '6', pname)} />
          <Chip title="Set PAR 12" onPress={() => updatePar(pid, '12', pname)} />
          <Chip
            title="Custom PAR…"
            onPress={() =>
              setParEditor({
                visible: true,
                productId: pid,
                productName: pname,
                value: '',
              })
            }
          />
          <Chip
            title="Assign supplier…"
            onPress={() =>
              setPicker({
                visible: true,
                bucketKey: null,
                productId: pid,
                productName: pname,
              })
            }
          />
        </View>
      </View>
    );
  };

  const renderBucketCard = ({ item }: { item: { key: string; bucket: CompatBucket } }) => {
    const key = item.key || 'unassigned';
    const b = item.bucket;
    const count = b.lines.length;
    const isUnassigned = key === 'unassigned';
    const drafted = draftedSupplierIds[key];

    const supplierLabel =
      suppliers.find((s) => s.id === key)?.name ?? (isUnassigned ? 'unassigned' : key);

    return (
      <View
        style={{
          margin: 12,
          padding: 12,
          borderRadius: 12,
          backgroundColor: '#fff',
          elevation: 2,
        }}
      >
        {/* Header with single group action + per-supplier draft CTAs */}
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 8,
            flexWrap: 'wrap',
          }}
        >
          <Text style={{ fontWeight: '700' }}>
            {supplierLabel} — {count} item{count > 1 ? 's' : ''}
          </Text>

          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
            {!isUnassigned && (
              <TouchableOpacity
                onPress={() => createDraftForBucket(key)}
                style={{ marginRight: 12 }}
              >
                <Text style={{ textDecorationLine: 'underline' }}>Create draft for supplier</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              onPress={() =>
                setPicker({ visible: true, bucketKey: key, productId: null, productName: null })
              }
            >
              <Text style={{ textDecorationLine: 'underline' }}>
                Assign supplier to group…
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {drafted && (
          <View
            style={{
              backgroundColor: '#eef7ff',
              borderRadius: 8,
              padding: 8,
              marginBottom: 8,
            }}
          >
            <Text style={{ fontSize: 12 }}>
              Draft created — go to Orders to finalise & send.
            </Text>
          </View>
        )}

        {/* Lines */}
        {b.lines.map(renderLine)}
      </View>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fafafa' }}>
      {/* Top bar */}
      <View
        style={{
          padding: 12,
          borderBottomWidth: 0.5,
          borderColor: '#eee',
        }}
      >
        <View
          style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
        >
          <Text style={{ fontSize: 18, fontWeight: '800' }}>Suggested Orders</Text>
          <View style={{ flexDirection: 'row' }}>
            <TouchableOpacity onPress={load} style={{ marginRight: 12 }}>
              <Text style={{ textDecorationLine: 'underline' }}>
                {loading ? 'Loading…' : 'Refresh'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={createDraftsAllVisible}>
              <Text style={{ textDecorationLine: 'underline' }}>Create drafts (all)</Text>
            </TouchableOpacity>
          </View>
        </View>

        {lastCompletedAt && (
          <Text style={{ marginTop: 6, color: '#666' }}>
            Based on stock-take completed: {lastCompletedAt}
          </Text>
        )}
      </View>

      {/* One card per unique bucket */}
      <FlatList
        data={uniqueBuckets}
        keyExtractor={(x) => x.key}
        renderItem={renderBucketCard}
        contentContainerStyle={{ paddingBottom: 48 }}
      />

      {/* Supplier picker modal (group or item depending on picker state) */}
      <Modal
        visible={picker.visible}
        transparent
        animationType="fade"
        onRequestClose={() =>
          setPicker({ visible: false, bucketKey: null, productId: null, productName: null })
        }
      >
        <View
          style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.3)',
            justifyContent: 'center',
            padding: 24,
          }}
        >
          <View
            style={{ backgroundColor: '#fff', borderRadius: 12, padding: 12, maxHeight: '70%' }}
          >
            <Text style={{ fontWeight: '800', fontSize: 16, marginBottom: 8 }}>
              Choose Supplier
            </Text>
            <ScrollView>
              {suppliers.map((s) => (
                <TouchableOpacity
                  key={s.id}
                  onPress={async () => {
                    if (picker.productId) {
                      await assignSupplierOne(picker.productId, picker.productName, s.id);
                    } else if (picker.bucketKey) {
                      const bucket = buckets[picker.bucketKey];
                      if (bucket) await assignSupplierGroup(bucket, s.id);
                    }
                  }}
                >
                  <View
                    style={{ paddingVertical: 10, borderBottomWidth: 0.5, borderColor: '#eee' }}
                  >
                    <Text>{s.name ?? s.id}</Text>
                  </View>
                </TouchableOpacity>
              ))}
              {!suppliers.length && <Text>No suppliers found.</Text>}
            </ScrollView>

            <TouchableOpacity
              onPress={() =>
                setPicker({ visible: false, bucketKey: null, productId: null, productName: null })
              }
              style={{ alignSelf: 'flex-end', marginTop: 8 }}
            >
              <Text style={{ textDecorationLine: 'underline' }}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Custom PAR modal */}
      <Modal
        visible={parEditor.visible}
        transparent
        animationType="fade"
        onRequestClose={() =>
          setParEditor({ visible: false, productId: null, productName: null, value: '' })
        }
      >
        <View
          style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.3)',
            justifyContent: 'center',
            padding: 24,
          }}
        >
          <View style={{ backgroundColor: '#fff', borderRadius: 12, padding: 12 }}>
            <Text style={{ fontWeight: '800', fontSize: 16, marginBottom: 8 }}>
              Set PAR — {parEditor.productName ?? parEditor.productId}
            </Text>

            <TextInput
              value={parEditor.value}
              onChangeText={(t) => setParEditor((s) => ({ ...s, value: t }))}
              placeholder="Enter a number"
              keyboardType="number-pad"
              style={{
                borderWidth: 1,
                borderColor: '#ddd',
                borderRadius: 8,
                paddingHorizontal: 10,
                paddingVertical: 8,
              }}
            />

            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'flex-end',
                marginTop: 12,
              }}
            >
              <TouchableOpacity
                onPress={() =>
                  setParEditor({
                    visible: false,
                    productId: null,
                    productName: null,
                    value: '',
                  })
                }
              >
                <Text style={{ marginRight: 16, textDecorationLine: 'underline' }}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => {
                  const pid = parEditor.productId;
                  const name = parEditor.productName ?? parEditor.productId ?? undefined;
                  const v = parEditor.value.trim();
                  if (!pid || !v) {
                    setParEditor({ visible: false, productId: null, productName: null, value: '' });
                    return;
                  }
                  setParEditor({ visible: false, productId: null, productName: null, value: '' });
                  updatePar(pid, v, name);
                }}
              >
                <Text style={{ textDecorationLine: 'underline' }}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}


