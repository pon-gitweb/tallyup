// @ts-nocheck
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  SafeAreaView,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { getApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  getDocs,
  getDoc,
  doc,
  setDoc,
  updateDoc,
  serverTimestamp,
  query,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  buildSuggestedOrdersInMemory,
  listSuppliers,
} from 'src/services/orders';
import { useVenueId } from 'src/context/VenueProvider';
import { useNavigation } from '@react-navigation/native';
import useLastCompletedAt from 'src/hooks/useLastCompletedAt';

type Supplier = { id: string; name?: string | null };
type SuggestedLine = {
  productId: string;
  productName?: string | null;
  qty: number;
  cost: number;
  needsPar?: boolean;
  needsSupplier?: boolean;
  reason?: string | null;
  supplierId?: string | null;
  supplierName?: string | null;
};
type CompatBucket = { items: Record<string, SuggestedLine>; lines: SuggestedLine[] };

function fmt(ts: number) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short', year: 'numeric', month: 'short', day: '2-digit', hour: 'numeric', minute: '2-digit',
  }).format(new Date(ts));
}

async function ensureProductIfMissing(venueId: string, productId: string, nameHint?: string | null) {
  const db = getFirestore(getApp());
  const ref = doc(db, 'venues', venueId, 'products', productId);
  await setDoc(ref, { name: nameHint ?? productId, updatedAt: serverTimestamp() }, { merge: true });
}

/**
 * Compat write: set supplier on product and ALL area items that are (or should be) linked to this product.
 * Also links orphans by id/name. Writes multiple common field variants.
 */
async function upsertSupplierEverywhereForProduct(
  venueId: string,
  productId: string,
  supplierId: string,
  supplierName: string | null,
  nameHint?: string | null
): Promise<number> {
  const db = getFirestore(getApp());
  const now = serverTimestamp();
  const supplierDocRef = doc(db, 'venues', venueId, 'suppliers', supplierId);

  const compat: any = {
    supplierId,
    supplierName,
    supplier: { id: supplierId, name: supplierName ?? supplierId },
    supplier_id: supplierId,
    supplierID: supplierId,
    vendorId: supplierId,
    vendor: { id: supplierId, name: supplierName ?? supplierId },
    supplierRef: supplierDocRef,
    supplierRefId: supplierId,
    vendorRef: supplierDocRef,
    vendorRefId: supplierId,
    updatedAt: now,
  };

  await setDoc(
    doc(db, 'venues', venueId, 'products', productId),
    { name: nameHint ?? productId, ...compat },
    { merge: true }
  );

  let updatedCount = 0;
  const deps = await getDocs(collection(db, 'venues', venueId, 'departments'));
  for (const dep of deps.docs) {
    const areas = await getDocs(collection(db, 'venues', venueId, 'departments', dep.id, 'areas'));
    for (const area of areas.docs) {
      const items = await getDocs(collection(db, 'venues', venueId, 'departments', dep.id, 'areas', area.id, 'items'));
      for (const it of items.docs) {
        const d = it.data() as any;
        const hasProduct = !!d?.productId;
        const idMatch = it.id === productId;
        const nameMatch = (d?.name ?? d?.productName ?? '') === (nameHint ?? productId);
        const shouldLink = !hasProduct && (idMatch || nameMatch);
        const isThisProduct = d?.productId === productId;

        if (shouldLink || isThisProduct) {
          const ref = doc(db, 'venues', venueId, 'departments', dep.id, 'areas', area.id, 'items', it.id);
          const update: any = { ...compat };
          if (shouldLink) update.productId = productId;
          await updateDoc(ref, update);
          updatedCount += 1;
        }
      }
    }
  }

  console.log('[SupplierCompat] upsert done', { productId, supplierId, updatedCount });
  return updatedCount;
}

/** Extract supplier from a product document using multiple fallbacks */
function extractSupplierFromProductDoc(pd: any): { supplierId?: string | null; supplierName?: string | null } {
  if (!pd) return {};
  const sid =
    pd.supplierId ??
    pd.supplierRefId ??
    (pd.supplier && (pd.supplier.id || pd.supplier.uid)) ??
    pd.vendorId ??
    (pd.vendor && (pd.vendor.id || pd.vendor.uid)) ??
    (pd.supplierRef && pd.supplierRef.id) ??
    (pd.vendorRef && pd.vendorRef.id) ??
    null;

  const sname =
    pd.supplierName ??
    (pd.supplier && pd.supplier.name) ??
    (pd.vendor && pd.vendor.name) ??
    null;

  return { supplierId: sid ?? null, supplierName: sname ?? null };
}

export default function SuggestedOrderScreen() {
  const venueId = useVenueId();
  const nav = useNavigation<any>();
  const [loading, setLoading] = useState(false);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [buckets, setBuckets] = useState<Record<string, CompatBucket>>({});
  const [picker, setPicker] = useState<{ visible: boolean; bucketKey: string | null; productId: string | null; }>
    ({ visible: false, bucketKey: null, productId: null });

  // Per-supplier draft menu (for mixed/unknown groups)
  const [perSupplierMenu, setPerSupplierMenu] = useState<{ visible: boolean; bucketKey: string | null }>({
    visible: false, bucketKey: null,
  });

  // Banner / cycle
  const { loading: bannerLoading, ts: lastCompletedAt, error: bannerError } = useLastCompletedAt(venueId);
  const cycleId = lastCompletedAt ? `cycle_${lastCompletedAt.toMillis()}` : 'cycle_unknown';

  // Draft markers
  const [draftBySupplier, setDraftBySupplier] = useState<Record<string, true>>({});
  const [draftByProduct, setDraftByProduct] = useState<Record<string, true>>({});
  const [isStale, setIsStale] = useState(false);

  const isKnownSupplier = useCallback((sid?: string | null) => {
    if (!sid || sid === 'unassigned') return false;
    return suppliers.some(s => s.id === sid);
  }, [suppliers]);

  const supplierNameOf = useCallback((sid?: string | null, fallback?: string | null) => {
    const found = suppliers.find(s => s.id === sid);
    if (found) return found.name ?? sid ?? 'Supplier';
    if (!sid || sid === 'unassigned') return 'Unassigned supplier';
    return `Unknown supplier (${String(sid).slice(0, 6)}…)`;
  }, [suppliers]);

  /**
   * Load suggestions + suppliers, then HYDRATE lines with supplier info from product docs if missing.
   * Auto-reloads whenever lastCompletedAt changes → auto-hide stale post-finalization.
   */
  const load = useCallback(async () => {
    if (!venueId) return;
    setLoading(true);
    try {
      // 1) Build suggestions
      const compat = await buildSuggestedOrdersInMemory(venueId, {
        roundToPack: true,
        defaultParIfMissing: 6,
      });

      // 2) Load suppliers
      const ss = await listSuppliers(venueId);
      setSuppliers(ss);
      const known = new Set(ss.map(s => s.id));

      // 3) Collect productIds used in suggestions
      const productIds = new Set<string>();
      Object.values(compat).forEach((b: any) => b?.lines?.forEach((ln: any) => ln?.productId && productIds.add(ln.productId)));

      // 4) Fetch product docs for hydration
      const db = getFirestore(getApp());
      const productMap = new Map<string, any>();
      for (const pid of productIds) {
        const snap = await getDoc(doc(db, 'venues', venueId, 'products', pid));
        productMap.set(pid, snap.exists() ? snap.data() : null);
      }

      // 5) Hydrate supplier on each line if missing/unknown
      const nextBuckets: Record<string, CompatBucket> = {};
      Object.entries(compat).forEach(([key, b]: any) => {
        const newLines: SuggestedLine[] = [];
        (b?.lines || []).forEach((ln: any) => {
          let sid: string | null | undefined = ln.supplierId;
          let sname: string | null | undefined = ln.supplierName;

          if (!sid || !known.has(sid)) {
            const pd = productMap.get(ln.productId);
            const fromPd = extractSupplierFromProductDoc(pd);
            if (fromPd.supplierId && (!sid || !known.has(sid))) {
              sid = fromPd.supplierId;
              sname = fromPd.supplierName ?? sname;
            }
          }

          const hydrated: SuggestedLine = {
            ...ln,
            supplierId: sid ?? null,
            supplierName: sname ?? null,
            needsSupplier: !sid || !known.has(sid) ? true : false,
          };
          newLines.push(hydrated);
        });
        nextBuckets[key] = { ...b, lines: newLines, items: b.items || {} };
      });

      // Visibility logs
      const vals: any[] = Object.values(nextBuckets);
      const perSupplierCounts: Record<string, number> = {};
      const countedProductIds = new Set<string>();
      vals.forEach((b: any) => {
        b.lines?.forEach((ln: any) => {
          countedProductIds.add(ln.productId);
          const sid = ln.supplierId ?? 'unassigned';
          perSupplierCounts[sid] = (perSupplierCounts[sid] ?? 0) + 1;
        });
      });
      console.log('[SuggestedOrders] countedProductIds', { count: countedProductIds.size });
      console.log('[SuggestedOrders] summary', { suppliersWithLines: Object.keys(perSupplierCounts).length, totalLines: vals.reduce((a, b: any) => a + (b.lines?.length ?? 0), 0) });
      console.log('[SuggestedOrders] perSupplierCounts', perSupplierCounts);

      setBuckets(nextBuckets);
    } catch (e) {
      console.warn('[SuggestedOrders] load failed', e);
      Alert.alert('Suggested Orders', 'Failed to load suggestions.');
    } finally {
      setLoading(false);
    }
  }, [venueId]);

  /** Draft markers for current cycle */
  const loadDraftMarkers = useCallback(async () => {
    try {
      if (!venueId || !cycleId || cycleId === 'cycle_unknown') { setDraftBySupplier({}); setDraftByProduct({}); return; }
      const db = getFirestore(getApp());
      const q1 = query(
        collection(db, 'venues', venueId, 'orders'),
        where('status', '==', 'draft'),
        where('suggestionCycleId', '==', cycleId),
      );
      const snap = await getDocs(q1);
      const sup: Record<string, true> = {};
      const prod: Record<string, true> = {};
      for (const d of snap.docs) {
        const v = d.data() as any;
        if (v?.supplierId) sup[v.supplierId] = true;
        const lines = await getDocs(collection(db, 'venues', venueId, 'orders', d.id, 'lines'));
        lines.forEach(ln => { const lv = ln.data() as any; if (lv?.productId) prod[lv.productId] = true; });
      }
      setDraftBySupplier(sup);
      setDraftByProduct(prod);
    } catch {
      setDraftBySupplier({});
      setDraftByProduct({});
    }
  }, [venueId, cycleId]);

  /** Detect stale suggestions hint (optional banner) */
  const detectStale = useCallback(async () => {
    try {
      if (!venueId) { setIsStale(false); return; }
      // If lastCompletedAt changes, load() runs (see effect below). This hint remains optional.
      setIsStale(false);
    } catch {
      setIsStale(false);
    }
  }, [venueId]);

  // Initial + on demand
  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadDraftMarkers(); detectStale(); }, [loadDraftMarkers, detectStale]);

  // 🔁 Auto-hide stale: react to new stock take (lastCompletedAt changed) → auto reload suggestions
  useEffect(() => {
    // changes in lastCompletedAt imply a new cycle; auto-reload suggestions
    if (venueId && lastCompletedAt) {
      load();
      loadDraftMarkers();
    }
  }, [venueId, lastCompletedAt?.toMillis()]); // eslint-disable-line react-hooks/exhaustive-deps

  /** De-dupe keys (keep builder’s grouping, but we won’t trust header for supplier) */
  const uniqueBucketKeys = useMemo(() => {
    const seen = new WeakSet<object>();
    const out: string[] = [];
    for (const [k, b] of Object.entries(buckets)) {
      if (b && typeof b === 'object' && !seen.has(b as object) && (b.lines?.length ?? 0) > 0) {
        seen.add(b as object);
        out.push(k);
      }
    }
    return out;
  }, [buckets]);

  /** Build “needs supplier / par” summary for the small helper panel */
  const setupNeeds = useMemo(() => {
    let needsSupplier = false, needsPar = false;
    for (const k of uniqueBucketKeys) {
      const b = buckets[k];
      if (!b) continue;
      for (const ln of b.lines) {
        if (!ln.supplierId || !isKnownSupplier(ln.supplierId)) needsSupplier = true;
        if (ln.needsPar) needsPar = true;
      }
    }
    return { needsSupplier, needsPar };
  }, [uniqueBucketKeys, buckets, isKnownSupplier]);

  /** Create draft (per supplier) with duplicate guard + quantity aggregation on merge */
  const createOrMergeDraft = useCallback(async (supplierId: string, supplierName: string, lines: SuggestedLine[]) => {
    const db = getFirestore(getApp());
    if (!venueId) throw new Error('No venue selected');

    // Keep only orderable lines for this supplier
    const valid = (lines || []).filter(l => l?.productId && Number(l?.qty) > 0 && l?.supplierId === supplierId);
    if (!valid.length) { Alert.alert('Draft', 'No orderable lines for this supplier.'); return { createdOrMerged: false }; }

    const now = serverTimestamp();
    const q1 = query(
      collection(db, 'venues', venueId, 'orders'),
      where('status', '==', 'draft'),
      where('supplierId', '==', supplierId),
      where('suggestionCycleId', '==', cycleId),
    );
    const snap = await getDocs(q1);

    if (!snap.empty) {
      // Merge path: aggregate quantities predictably
      const existing = snap.docs[0];
      const orderRef = doc(db, 'venues', venueId, 'orders', existing.id);
      await setDoc(orderRef, {
        status: 'draft',
        supplierId,
        supplierName,
        suggestionCycleId: cycleId,
        source: 'suggested',
        origin: 'suggested',
        displayStatus: 'Draft',
        updatedAt: now,
      }, { merge: true });

      for (const it of valid) {
        const lineRef = doc(orderRef, 'lines', it.productId);
        const prev = await getDoc(lineRef);
        const prevQty = Number(prev.exists() ? (prev.data() as any)?.qty ?? 0 : 0);
        const nextQty = prevQty + Number(it.qty);
        await setDoc(lineRef, {
          productId: it.productId,
          name: it.productName || it.productId,
          qty: nextQty,
          updatedAt: now,
        }, { merge: true });
      }
      return { createdOrMerged: true, merged: true };
    }

    // New draft
    const newOrderRef = doc(collection(db, 'venues', venueId, 'orders'));
    const batch = writeBatch(db);
    batch.set(newOrderRef, {
      status: 'draft',
      supplierId,
      supplierName,
      suggestionCycleId: cycleId,
      source: 'suggested',
      origin: 'suggested',
      displayStatus: 'Draft',
      createdAt: now,
      updatedAt: now,
    });
    valid.forEach((it) => {
      batch.set(doc(newOrderRef, 'lines', it.productId), {
        productId: it.productId,
        name: it.productName || it.productId,
        qty: Number(it.qty),
        createdAt: now,
        updatedAt: now,
      });
    });
    await batch.commit();
    return { createdOrMerged: true, merged: false };
  }, [venueId, cycleId]);

  /** “Create Drafts (All)” still supported: per-line bucketing by supplierId */
  const createDraftsForAllSuppliers = useCallback(async () => {
    if (!venueId) return;
    const perSupplier = new Map<string, { supplierName: string; lines: SuggestedLine[] }>();
    let skippedUnknown = 0;

    uniqueBucketKeys.forEach(k => {
      const b = buckets[k];
      b?.lines?.forEach((ln) => {
        const sid = ln.supplierId;
        if (!sid || !isKnownSupplier(sid)) { skippedUnknown += 1; return; }
        const sname = supplierNameOf(sid, ln.supplierName);
        const prev = perSupplier.get(sid) || { supplierName: sname, lines: [] };
        prev.lines.push(ln);
        perSupplier.set(sid, prev);
      });
    });

    if (perSupplier.size === 0) {
      Alert.alert('Drafts', skippedUnknown ? 'All lines need a valid supplier before drafts can be created.' : 'No suppliers with orderable lines.');
      return;
    }

    let processed = 0, mergedCount = 0;
    for (const [sid, { supplierName, lines }] of perSupplier.entries()) {
      const res = await createOrMergeDraft(sid, supplierName, lines);
      if (res?.createdOrMerged) { processed += 1; if (res.merged) mergedCount += 1; }
    }
    await loadDraftMarkers();
    Alert.alert('Drafts', `Processed ${processed} supplier draft(s).${mergedCount ? ` ${mergedCount} merged.` : ''}${skippedUnknown ? ` Skipped ${skippedUnknown} line(s) without a valid supplier.` : ''}`);
    nav.navigate('Orders');
  }, [venueId, uniqueBucketKeys, buckets, isKnownSupplier, supplierNameOf, createOrMergeDraft, loadDraftMarkers, nav]);

  /** Assign supplier (GROUP) */
  const assignSupplierGroup = useCallback(
    async (bucketKey: string, supplierId: string) => {
      try {
        if (!venueId) throw new Error('No venue selected');
        const bucket = buckets[bucketKey];
        if (!bucket) return;
        const name = suppliers.find((s) => s.id === supplierId)?.name ?? null;

        let totalUpdated = 0;
        for (const line of bucket.lines) {
          const pid = line.productId;
          if (!pid) continue;
          await ensureProductIfMissing(venueId, pid, line.productName ?? pid);
          totalUpdated += await upsertSupplierEverywhereForProduct(venueId, pid, supplierId, name, line.productName ?? pid);
        }

        console.log('[SupplierCompat] group assigned', { supplierId, totalUpdated });
        setPicker({ visible: false, bucketKey: null, productId: null });
        await load(); // hydration ensures UI reflects it even if builder lags
      } catch (e: any) {
        Alert.alert('Supplier', `[${e?.code ?? 'unknown'}] ${e?.message ?? 'Failed to set supplier.'}`);
      }
    },
    [venueId, buckets, suppliers, load]
  );

  /** Assign supplier (ONE ITEM) */
  const assignSupplierOne = useCallback(
    async (productId: string, productName: string | null | undefined, supplierId: string) => {
      try {
        if (!venueId) throw new Error('No venue selected');
        const name = suppliers.find((s) => s.id === supplierId)?.name ?? null;

        await ensureProductIfMissing(venueId, productId, productName ?? productId);
        const n = await upsertSupplierEverywhereForProduct(venueId, productId, supplierId, name, productName ?? productId);
        console.log('[SupplierCompat] single assigned', { productId, supplierId, updatedItems: n });

        setPicker({ visible: false, bucketKey: null, productId: null });
        await load();
      } catch (e: any) {
        Alert.alert('Supplier', `[${e?.code ?? 'unknown'}] ${e?.message ?? 'Failed to set supplier.'}`);
      }
    },
    [venueId, suppliers, load]
  );

  /** Header label state (derived from lines) */
  function headerSupplierState(b: CompatBucket) {
    const sids = new Set<string>();
    b.lines?.forEach((ln) => { if (ln?.supplierId) sids.add(ln.supplierId); });
    if (sids.size === 0) return { label: 'Unassigned supplier', sid: null, known: false, mixed: false };
    if (sids.size > 1) return { label: 'Multiple suppliers', sid: null, known: false, mixed: true };
    const sid = [...sids][0];
    const known = isKnownSupplier(sid);
    return { label: supplierNameOf(sid), sid, known, mixed: false };
  }

  /** List known suppliers present in this bucket (for per-supplier draft menu) */
  function knownSuppliersInBucket(b: CompatBucket): Array<{ supplierId: string; supplierName: string; count: number }> {
    const map = new Map<string, { supplierName: string; count: number }>();
    (b.lines || []).forEach(ln => {
      const sid = ln.supplierId;
      if (!sid || !isKnownSupplier(sid)) return;
      const name = supplierNameOf(sid, ln.supplierName);
      const prev = map.get(sid) || { supplierName: name, count: 0 };
      prev.count += 1;
      map.set(sid, prev);
    });
    return [...map.entries()].map(([supplierId, { supplierName, count }]) => ({ supplierId, supplierName, count }));
  }

  const renderBucket = ({ item: key }: { item: string }) => {
    const b = buckets[key];
    const count = b?.lines?.length ?? 0;
    if (!b || !count) return null;

    const { label, sid, known, mixed } = headerSupplierState(b);
    const groupDrafted = sid && known ? !!draftBySupplier[sid] : false;

    const perSupplier = knownSuppliersInBucket(b); // for menu

    return (
      <View style={{ margin: 12, padding: 12, borderRadius: 12, backgroundColor: '#fff', elevation: 2 }}>
        {/* Group header */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <Text style={{ fontWeight: '700', flexShrink: 1 }}>
            {label} — {count} item{count > 1 ? 's' : ''}{' '}
            {groupDrafted ? <Text style={{ color: '#059669' }}>• Draft generated</Text> : null}
            {!known ? <Text style={{ color: '#b45309' }}>  • Supplier not set</Text> : null}
            {mixed ? <Text style={{ color: '#6b7280' }}>  • Mixed</Text> : null}
          </Text>

          <View style={{ flexDirection: 'row' }}>
            {known && !mixed ? (
              <TouchableOpacity
                onPress={() => createOrMergeDraft(sid!, supplierNameOf(sid!), b.lines)}
                style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: '#e5e7eb', marginRight: 8 }}
              >
                <Text style={{ fontWeight: '600' }}>Create Draft</Text>
              </TouchableOpacity>
            ) : null}

            {/* Per-supplier menu always available if any known suppliers in this bucket */}
            {perSupplier.length > 0 ? (
              <TouchableOpacity
                onPress={() => setPerSupplierMenu({ visible: true, bucketKey: key })}
                style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: '#e5e7eb' }}
              >
                <Text style={{ fontWeight: '600' }}>Per-supplier…</Text>
              </TouchableOpacity>
            ) : (
              // Otherwise offer Assign Supplier
              <TouchableOpacity
                onPress={() => setPicker({ visible: true, bucketKey: key, productId: null })}
                style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: '#111827' }}
              >
                <Text style={{ color: 'white', fontWeight: '700' }}>Assign Supplier</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {b.lines.map((line) => {
          const needsSupplier = !line.supplierId || !isKnownSupplier(line.supplierId);
          const needsPar = !!line.needsPar;
          const qty = Number(line.qty || 0);
          const drafted = line.productId ? !!draftByProduct[line.productId] : false;

          return (
            <View key={line.productId || `${line.productName}-${Math.random().toString(36).slice(2)}`}
                  style={{ paddingVertical: 10, borderTopWidth: 0.5, borderColor: '#eee' }}>
              <Text style={{ fontWeight: '600' }}>
                {line.productName ?? line.productId}{' '}
                {drafted ? <Text style={{ color: '#059669' }}>• Draft generated</Text> : null}
              </Text>
              <Text style={{ marginTop: 4 }}>Suggested order: <Text style={{ fontWeight: '700' }}>{qty}</Text></Text>
              {!!line.cost && <Text>Estimated cost: ${Number(line.cost).toFixed(2)}</Text>}
              {(needsPar || needsSupplier) && (
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
                  {needsPar && (
                    <>
                      <Chip onPress={() => updatePar(line.productId, '6', line.productName)}>Set PAR 6</Chip>
                      <Chip onPress={() => updatePar(line.productId, '12', line.productName)}>Set PAR 12</Chip>
                    </>
                  )}
                  {needsSupplier && (
                    <Chip onPress={() => setPicker({ visible: true, bucketKey: null, productId: line.productId })}>
                      Assign supplier…
                    </Chip>
                  )}
                </View>
              )}
            </View>
          );
        })}
      </View>
    );
  };

  /** Per-supplier menu content for a given bucket */
  function renderPerSupplierMenu() {
    if (!perSupplierMenu.visible || !perSupplierMenu.bucketKey) return null;
    const b = buckets[perSupplierMenu.bucketKey];
    const options = knownSuppliersInBucket(b || { lines: [], items: {} });

    return (
      <Modal visible transparent animationType="fade"
             onRequestClose={() => setPerSupplierMenu({ visible: false, bucketKey: null })}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'center', padding: 24 }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 12, padding: 12, maxHeight: '70%' }}>
            <Text style={{ fontWeight: '800', fontSize: 16, marginBottom: 8 }}>Create draft for…</Text>
            <ScrollView>
              {options.map(opt => (
                <TouchableOpacity
                  key={opt.supplierId}
                  onPress={async () => {
                    await createOrMergeDraft(opt.supplierId, opt.supplierName, b.lines);
                    await loadDraftMarkers();
                    setPerSupplierMenu({ visible: false, bucketKey: null });
                    Alert.alert('Draft', `Draft created for ${opt.supplierName}`);
                  }}
                >
                  <View style={{ paddingVertical: 10, borderBottomWidth: 0.5, borderColor: '#eee' }}>
                    <Text>{opt.supplierName}  <Text style={{ color: '#6b7280' }}>({opt.count} line{opt.count>1?'s':''})</Text></Text>
                  </View>
                </TouchableOpacity>
              ))}
              {options.length === 0 && <Text>No known suppliers in this group.</Text>}
            </ScrollView>

            <TouchableOpacity
              onPress={() => setPerSupplierMenu({ visible: false, bucketKey: null })}
              style={{ alignSelf: 'flex-end', marginTop: 8 }}
            >
              <Text style={{ textDecorationLine: 'underline' }}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fafafa' }}>
      {/* Context banner */}
      <View style={{ padding: 12, backgroundColor: '#f2f7ff', borderBottomWidth: 1, borderBottomColor: '#e0e7ff' }}>
        <Text style={{ fontWeight: '700' }}>Last stock take completed at:</Text>
        {bannerLoading ? (
          <Text>Loading…</Text>
        ) : bannerError ? (
          <Text style={{ color: '#b00020' }}>Failed to load: {bannerError}</Text>
        ) : lastCompletedAt ? (
          <Text>{fmt(lastCompletedAt.toMillis())}</Text>
        ) : (
          <Text>—</Text>
        )}
      </View>

      {/* Setup helper panel */}
      {(setupNeeds.needsSupplier || setupNeeds.needsPar) && (
        <View style={{ padding: 12, backgroundColor: '#fff7ed', borderBottomWidth: 1, borderBottomColor: '#fde68a' }}>
          <Text style={{ fontWeight: '700', marginBottom: 6 }}>Heads up</Text>
          {setupNeeds.needsSupplier ? <Text>Some products need a valid Supplier assigned.</Text> : null}
          {setupNeeds.needsPar ? <Text>Some products are missing a PAR level.</Text> : null}
        </View>
      )}

      {/* Optional stale hint (we auto-reload anyway) */}
      {isStale && (
        <View style={{ padding: 12, backgroundColor: '#fef2f2', borderBottomWidth: 1, borderBottomColor: '#fecaca' }}>
          <Text style={{ color: '#991b1b' }}>A newer stock take exists. Suggestions were refreshed.</Text>
        </View>
      )}

      {/* Header controls */}
      <View style={{ padding: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ fontSize: 18, fontWeight: '800' }}>Suggested Orders</Text>
        <View style={{ flexDirection: 'row' }}>
          <TouchableOpacity onPress={load} style={{ marginRight: 12 }}>
            <Text style={{ textDecorationLine: 'underline' }}>{loading ? 'Loading…' : 'Refresh'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={createDraftsForAllSuppliers}>
            <Text style={{ textDecorationLine: 'underline' }}>Create Drafts (All)</Text>
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        data={uniqueBucketKeys}
        keyExtractor={(k) => k}
        renderItem={renderBucket}
        contentContainerStyle={{ paddingBottom: 48 }}
      />

      {/* Supplier picker */}
      <Modal visible={picker.visible} transparent animationType="fade"
             onRequestClose={() => setPicker({ visible: false, bucketKey: null, productId: null })}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'center', padding: 24 }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 12, padding: 12, maxHeight: '70%' }}>
            <Text style={{ fontWeight: '800', fontSize: 16, marginBottom: 8 }}>Choose Supplier</Text>
            <ScrollView>
              {suppliers.map((s) => (
                <TouchableOpacity
                  key={s.id}
                  onPress={() => {
                    if (picker.productId) {
                      assignSupplierOne(picker.productId, null, s.id);
                    } else if (picker.bucketKey) {
                      assignSupplierGroup(picker.bucketKey, s.id);
                    }
                  }}
                >
                  <View style={{ paddingVertical: 10, borderBottomWidth: 0.5, borderColor: '#eee' }}>
                    <Text>{s.name ?? s.id}</Text>
                  </View>
                </TouchableOpacity>
              ))}
              {!suppliers.length && <Text>No suppliers found.</Text>}
            </ScrollView>

            <TouchableOpacity
              onPress={() => setPicker({ visible: false, bucketKey: null, productId: null })}
              style={{ alignSelf: 'flex-end', marginTop: 8 }}
            >
              <Text style={{ textDecorationLine: 'underline' }}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Per-supplier create menu */}
      {renderPerSupplierMenu()}
    </SafeAreaView>
  );
}

/** Tiny chip */
function Chip({ children, onPress }: { children: any; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress}>
      <Text style={{ paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#f2f2f2', borderRadius: 8, marginRight: 8, marginTop: 6 }}>
        {children}
      </Text>
    </TouchableOpacity>
  );
}
