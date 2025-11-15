// @ts-nocheck
import React, { useMemo, useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  TextInput,
  Alert,
  ActivityIndicator,
} from 'react-native';
import {
  getFirestore,
  doc,
  writeBatch,
  getDoc,
  collection,
  getDocs,
} from 'firebase/firestore';
import { getApp } from 'firebase/app';
import { useVenueId } from '../../../context/VenueProvider';

type Line = {
  id: string;
  productId?: string | null;
  name?: string | null;
  orderedQty?: number;
  qty?: number;
  unitCost?: number | null;
};

type Props = {
  orderId: string;
  venueId?: string;
  orderLines?: Line[];
  onDone?: () => void;
  onClose?: () => void;
  embed?: boolean;
};

export default function ManualReceiveScreen({
  orderId,
  venueId: propVenueId,
  orderLines = [],
  onDone,
  onClose,
  embed,
}: Props) {
  const venueIdFromHook = useVenueId();
  const venueId = propVenueId || venueIdFromHook;

  // Local copy of lines (either from props or Firestore)
  const [lines, setLines] = useState<Line[]>(orderLines || []);

  // Quantities for lines (keyed by id/productId)
  const [qty, setQty] = useState<Record<string, number>>(() =>
    Object.fromEntries(
      (orderLines || []).map((l) => [
        String(l.id || l.productId || ''),
        Number(l.orderedQty || l.qty || 0),
      ])
    )
  );

  // Promo additions (items not in the supplier catalogue)
  const [newName, setNewName] = useState('');
  const [newQty, setNewQty] = useState('');
  const [newUnitPrice, setNewUnitPrice] = useState('');
  const [extras, setExtras] = useState<
    Array<{ id: string; name: string; qty: number; unitPrice?: number | null }>
  >([]);

  const [header, setHeader] = useState<{
    supplierName?: string | null;
    poNumber?: string | null;
  }>({});

  const [loading, setLoading] = useState(
    !orderLines || orderLines.length === 0
  );

  const close = () => {
    if (onDone) onDone();
    else if (onClose) onClose();
  };

  // If parent ever passes in fresh orderLines, sync them in
  useEffect(() => {
    if (orderLines && orderLines.length) {
      setLines(orderLines);
      const initial = Object.fromEntries(
        (orderLines || []).map((l) => [
          String(l.id || l.productId || ''),
          Number(l.orderedQty || l.qty || 0),
        ])
      );
      setQty(initial);
      setLoading(false);
    }
  }, [orderLines]);

  // If no lines passed, fetch from Firestore using orderId + venueId
  useEffect(() => {
    if (orderLines && orderLines.length) return; // prefer prop
    if (!venueId || !orderId) return;

    let alive = true;
    (async () => {
      try {
        const db = getFirestore(getApp());
        const orderRef = doc(db, 'venues', venueId, 'orders', orderId);
        const snap = await getDoc(orderRef);
        if (!alive) return;

        if (snap.exists()) {
          const d: any = snap.data() || {};

          // Be generous with field names so header rarely ends up blank
          const supplierName =
            d.supplierName ||
            d.supplier ||
            d.supplierDisplayName ||
            d.vendorName ||
            d.vendor ||
            null;

          const poNumber =
            d.poNumber ||
            d.po ||
            d.poRef ||
            d.po_code ||
            d.poNumberClient ||
            d.poClient ||
            null;

          setHeader({ supplierName, poNumber });
        }

        const linesRef = collection(
          db,
          'venues',
          venueId,
          'orders',
          orderId,
          'lines'
        );
        const linesSnap = await getDocs(linesRef);
        const arr: Line[] = [];
        linesSnap.forEach((docSnap) => {
          const d: any = docSnap.data() || {};
          const orderedQty = Number.isFinite(d.qty)
            ? Number(d.qty)
            : Number(d.orderedQty || d.qty || 0);
          arr.push({
            id: docSnap.id,
            productId: d.productId || null,
            name: d.name || null,
            orderedQty,
            qty: orderedQty,
            unitCost: Number.isFinite(d.unitCost)
              ? Number(d.unitCost)
              : d.unitCost ?? null,
          });
        });

        setLines(arr);
        const initial = Object.fromEntries(
          arr.map((l) => [
            String(l.id || l.productId || ''),
            Number(l.orderedQty || l.qty || 0),
          ])
        );
        setQty(initial);
      } catch (e) {
        console.warn('[ManualReceive] load order failed', e);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [venueId, orderId, orderLines]);

  const totalLines = (lines?.length || 0) + (extras?.length || 0);

  const updateQty = (id: string, v: string) => {
    const n = Math.max(0, Number(v || 0));
    setQty((prev) => ({ ...prev, [id]: n }));
  };

  const addExtra = () => {
    const name = String(newName || '').trim();
    const q = Number(newQty || 0);
    const p = newUnitPrice === '' ? null : Number(newUnitPrice);

    if (!name) {
      Alert.alert('Missing name', 'Enter a product name.');
      return;
    }
    if (!Number.isFinite(q) || q <= 0) {
      Alert.alert('Invalid qty', 'Enter a quantity > 0.');
      return;
    }
    if (!(p === null || Number.isFinite(p))) {
      Alert.alert('Invalid price', 'Leave blank or enter a valid number.');
      return;
    }

    const id = `promo_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 7)}`;
    setExtras((prev) => [{ id, name, qty: q, unitPrice: p }, ...prev]);
    setNewName('');
    setNewQty('');
    setNewUnitPrice('');
  };

  const removeExtra = (id: string) =>
    setExtras((prev) => prev.filter((x) => x.id !== id));

  const submit = async () => {
    try {
      if (!venueId) {
        Alert.alert('No venue', 'Attach a venue first.');
        return;
      }
      const db = getFirestore(getApp());
      const orderRef = doc(db, 'venues', venueId, 'orders', orderId);
      const batch = writeBatch(db);

      // Build receiveLines snapshot = existing lines + promo extras
      const baseReceive = (lines || []).map((l) => {
        const id = String(l.id || l.productId || '');
        return {
          id,
          productId: l.productId || null,
          name: l.name || null,
          orderedQty: Number(l.orderedQty || l.qty || 0),
          receivedQty: Number(qty[id] || 0),
          invoiceUnitPrice: Number.isFinite(l.unitCost)
            ? Number(l.unitCost)
            : null,
          promo: false,
        };
      });

      const extraReceive = (extras || []).map((x) => ({
        id: x.id,
        productId: null,
        name: x.name,
        orderedQty: 0,
        receivedQty: Number(x.qty || 0),
        invoiceUnitPrice:
          x.unitPrice === null || x.unitPrice === undefined
            ? null
            : Number(x.unitPrice),
        promo: true,
      }));

      batch.set(
        orderRef,
        {
          status: 'received',
          displayStatus: 'received', // keep pill consistent
          receivedAt: new Date(),
          receiveMethod: 'manual',
          receiveLines: [...baseReceive, ...extraReceive],
        },
        { merge: true }
      );

      await batch.commit();
      close();
    } catch (e) {
      Alert.alert('Receive failed', String(e?.message || e));
    }
  };

  const ExistingLine = ({ item }: { item: Line }) => {
    const id = String(item.id || item.productId || '');
    const ordered = Number(item.orderedQty || item.qty || 0);

    return (
      <View style={S.row}>
        <View style={{ flex: 1, marginRight: 12 }}>
          <Text style={S.name}>{item.name || item.productId || 'Line'}</Text>
          <Text style={S.ghostSmall}>Ordered: {ordered}</Text>
        </View>
        <TextInput
          style={S.input}
          keyboardType="numeric"
          placeholder="0"
          defaultValue={String(qty[id] || 0)}
          onChangeText={(v) => updateQty(id, v)}
        />
      </View>
    );
  };

  const ExtraRow = ({ item }: { item: any }) => {
    return (
      <View style={S.row}>
        <Text style={S.name}>
          {item.name} <Text style={{ color: '#92400E' }}>(promo)</Text>
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={S.ghost}>Qty {item.qty}</Text>
          {item.unitPrice != null ? (
            <Text style={S.ghost}>
              @ ${Number(item.unitPrice).toFixed(2)}
            </Text>
          ) : null}
          <TouchableOpacity onPress={() => removeExtra(item.id)}>
            <Text style={S.remove}>Remove</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={[S.wrap, S.loading]}>
        <ActivityIndicator />
        <Text style={S.ghost}>Loading order lines…</Text>
      </View>
    );
  }

  const shortId = orderId ? orderId.slice(-6) : '';

  return (
    <View style={S.wrap}>
      {/* Header with Back / Close + PO context */}
      <View style={S.headerRow}>
        {!embed && (
          <TouchableOpacity onPress={close} style={S.backBtn}>
            <Text style={S.backTxt}>Back</Text>
          </TouchableOpacity>
        )}
        <View style={{ flex: 1 }}>
          <Text style={S.h}>Manual receive</Text>
          <Text style={S.sub}>
            {header.supplierName || 'Order'}
            {header.poNumber
              ? ` • PO ${header.poNumber}`
              : shortId
              ? ` • #${shortId}`
              : ''}
          </Text>
        </View>
      </View>

      {/* Existing order lines */}
      <FlatList
        data={lines || []}
        keyExtractor={(l) => String(l.id || l.productId || Math.random())}
        renderItem={ExistingLine}
        ListEmptyComponent={
          <Text style={S.ghost}>No lines on order.</Text>
        }
      />

      {/* Add promo item */}
      <View style={S.addBox}>
        <Text style={S.addH}>Add promo/new item</Text>
        <TextInput
          placeholder="Item name"
          value={newName}
          onChangeText={setNewName}
          style={S.inputWide}
        />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TextInput
            placeholder="Qty"
            value={newQty}
            onChangeText={setNewQty}
            keyboardType="numeric"
            style={[S.input, { flex: 1 }]}
          />
          <TextInput
            placeholder="Invoice unit $"
            value={newUnitPrice}
            onChangeText={setNewUnitPrice}
            keyboardType="numeric"
            style={[S.input, { flex: 1 }]}
          />
        </View>
        <TouchableOpacity onPress={addExtra} style={S.btnAdd}>
          <Text style={S.btnAddTxt}>Add item</Text>
        </TouchableOpacity>
      </View>

      {/* Extra items list */}
      {extras.length > 0 ? (
        <View style={{ marginTop: 8 }}>
          <Text style={S.addH}>Added items</Text>
          <FlatList data={extras} keyExtractor={(x) => x.id} renderItem={ExtraRow} />
        </View>
      ) : null}

      {/* Actions */}
      <TouchableOpacity onPress={submit} style={S.btn}>
        <Text style={S.btnTxt}>Confirm receive ({totalLines})</Text>
      </TouchableOpacity>

      {!embed && (
        <TouchableOpacity onPress={close} style={S.btnSecondary}>
          <Text style={S.btnSecondaryTxt}>Cancel</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const S = StyleSheet.create({
  wrap: { gap: 12, paddingVertical: 8, paddingHorizontal: 12, flex: 1 },
  loading: { alignItems: 'center', justifyContent: 'center' },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 8,
  },
  backBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginRight: 4,
  },
  backTxt: { fontSize: 12, fontWeight: '700', color: '#111827' },
  h: { fontSize: 16, fontWeight: '700' },
  sub: { marginTop: 2, color: '#6B7280', fontSize: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderColor: '#eee',
  },
  name: { flex: 1, marginRight: 12, fontWeight: '600' },
  input: {
    width: 100,
    height: 36,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 8,
  },
  inputWide: {
    height: 36,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 8,
    marginBottom: 8,
  },
  btn: {
    marginTop: 12,
    backgroundColor: '#0B5FFF',
    padding: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  btnTxt: { color: '#fff', fontWeight: '700' },
  btnSecondary: {
    marginTop: 8,
    backgroundColor: '#F3F4F6',
    padding: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  btnSecondaryTxt: { color: '#111827', fontWeight: '700' },
  addBox: {
    marginTop: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#FAFAFA',
  },
  addH: { fontSize: 14, fontWeight: '700', marginBottom: 8 },
  btnAdd: {
    marginTop: 8,
    backgroundColor: '#111827',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  btnAddTxt: { color: '#fff', fontWeight: '700' },
  remove: { color: '#B91C1C', fontWeight: '700' },
  ghost: { color: '#6B7280' },
  ghostSmall: { color: '#9CA3AF', fontSize: 11 },
});
