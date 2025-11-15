// @ts-nocheck
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, TextInput, Alert } from 'react-native';
import { getFirestore, doc, writeBatch } from 'firebase/firestore';
import { getApp } from 'firebase/app';

type Line = {
  id?: string;
  productId?: string;
  name?: string;
  qty?: number;
  orderedQty?: number;
  unitCost?: number;
};

type Props = {
  orderId: string;
  venueId: string;
  orderLines?: Line[];
  onDone?: () => void;
  onClose?: () => void;
  embed?: boolean; // if ever embedded inside another screen, hides header/back
};

export default function ManualReceiveScreen({
  orderId,
  venueId,
  orderLines = [],
  onDone,
  onClose,
  embed,
}: Props) {
  // Quantities for existing order lines – default to ordered qty (or qty) so user just tweaks
  const [qty, setQty] = useState(() =>
    Object.fromEntries(
      (orderLines || []).map((l) => [
        String(l.id || l.productId || ''),
        Number(l.orderedQty ?? l.qty ?? 0),
      ]),
    ),
  );

  // Promo additions (items not in the supplier catalogue)
  const [newName, setNewName] = useState('');
  const [newQty, setNewQty] = useState('');
  const [newUnitPrice, setNewUnitPrice] = useState('');
  const [extras, setExtras] = useState<
    Array<{ id: string; name: string; qty: number; unitPrice?: number | null }>
  >([]);

  const totalLines = (orderLines?.length || 0) + (extras?.length || 0);

  const handleClose = () => {
    if (onClose) onClose();
    else if (onDone) onDone();
  };

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
    const id = `promo_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    setExtras((prev) => [{ id, name, qty: q, unitPrice: p }, ...prev]);
    setNewName('');
    setNewQty('');
    setNewUnitPrice('');
  };

  const removeExtra = (id: string) => setExtras((prev) => prev.filter((x) => x.id !== id));

  const submit = async () => {
    try {
      if (!venueId || !orderId) {
        throw new Error('Missing venue or order reference.');
      }

      const db = getFirestore(getApp());
      const orderRef = doc(db, 'venues', venueId, 'orders', orderId);
      const batch = writeBatch(db);

      // Build receiveLines snapshot = existing lines + promo extras
      const baseReceive = (orderLines || []).map((l) => {
        const id = String(l.id || l.productId || '');
        const orderedQty = Number(l.orderedQty ?? l.qty ?? 0);
        return {
          id,
          productId: l.productId || null,
          name: l.name || null,
          orderedQty,
          receivedQty: Number(qty[id] ?? orderedQty ?? 0),
          invoiceUnitPrice: Number.isFinite(l.unitCost) ? Number(l.unitCost) : null,
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
          x.unitPrice === null || x.unitPrice === undefined ? null : Number(x.unitPrice),
        promo: true,
      }));

      batch.set(
        orderRef,
        {
          status: 'received',
          displayStatus: 'received', // keep OrdersScreen pill consistent
          receivedAt: new Date(),
          receiveMethod: 'manual',
          receiveLines: [...baseReceive, ...extraReceive],
        },
        { merge: true },
      );

      await batch.commit();
      onDone?.();
    } catch (e: any) {
      Alert.alert('Receive failed', String(e?.message || e));
    }
  };

  const ExistingLine = ({ item }: { item: Line }) => {
    const id = String(item.id || item.productId || '');
    const ordered = Number(item.orderedQty ?? item.qty ?? 0);
    return (
      <View style={S.row}>
        <View style={{ flex: 1, marginRight: 12 }}>
          <Text style={S.name}>{item.name || item.productId || 'Line'}</Text>
          <Text style={S.ghost}>Ordered {ordered}</Text>
        </View>
        <View>
          <Text style={S.inputLabel}>Received</Text>
          <TextInput
            style={S.input}
            keyboardType="numeric"
            placeholder="0"
            defaultValue={String(qty[id] ?? ordered ?? 0)}
            onChangeText={(v) => updateQty(id, v)}
          />
        </View>
      </View>
    );
  };

  const ExtraRow = ({ item }: { item: { id: string; name: string; qty: number; unitPrice?: number | null } }) => {
    return (
      <View style={S.row}>
        <View style={{ flex: 1, marginRight: 12 }}>
          <Text style={S.name}>
            {item.name} <Text style={{ color: '#92400E' }}>(promo)</Text>
          </Text>
          <Text style={S.ghost}>Qty {item.qty}</Text>
          {item.unitPrice != null ? (
            <Text style={S.ghost}>@ ${Number(item.unitPrice).toFixed(2)}</Text>
          ) : null}
        </View>
        <TouchableOpacity onPress={() => removeExtra(item.id)}>
          <Text style={S.remove}>Remove</Text>
        </TouchableOpacity>
      </View>
    );
  };

  const hasOrderLines = (orderLines || []).length > 0;

  return (
    <View style={S.wrap}>
      {!embed && (
        <View style={S.header}>
          <TouchableOpacity onPress={handleClose} style={S.headerBack}>
            <Text style={S.headerBackTxt}>Close</Text>
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={S.headerTitle}>Manual receive</Text>
            <Text style={S.headerSub}>
              Review the PO lines and enter received quantities against the invoice.
            </Text>
          </View>
        </View>
      )}

      {/* Existing order lines */}
      <FlatList
        data={orderLines || []}
        keyExtractor={(l) => String(l.id || l.productId || Math.random())}
        renderItem={ExistingLine}
        ListEmptyComponent={
          <Text style={S.ghost}>
            No lines on this order. You can still add promo/new items below.
          </Text>
        }
        contentContainerStyle={{ paddingBottom: 12 }}
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

      {/* Footer actions */}
      <View style={S.footerRow}>
        <TouchableOpacity onPress={handleClose} style={S.btnSecondary}>
          <Text style={S.btnSecondaryTxt}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={submit} style={S.btnPrimary} disabled={totalLines === 0}>
          <Text style={S.btnPrimaryTxt}>
            {totalLines === 0 ? 'Confirm receive' : `Confirm receive (${totalLines})`}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const S = StyleSheet.create({
  wrap: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#FFFFFF',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 8,
  },
  headerBack: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  headerBackTxt: {
    fontSize: 12,
    fontWeight: '700',
    color: '#111827',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '800',
  },
  headerSub: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderColor: '#F3F4F6',
  },
  name: {
    fontWeight: '700',
  },
  inputLabel: {
    fontSize: 11,
    color: '#6B7280',
    marginBottom: 2,
  },
  input: {
    width: 90,
    height: 36,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    paddingHorizontal: 8,
    backgroundColor: '#FFFFFF',
  },
  inputWide: {
    height: 36,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    paddingHorizontal: 8,
    marginBottom: 8,
    backgroundColor: '#FFFFFF',
  },

  btnPrimary: {
    flex: 1,
    backgroundColor: '#0B5FFF',
    padding: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  btnPrimaryTxt: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  btnSecondary: {
    flex: 1,
    backgroundColor: '#F3F4F6',
    padding: 12,
    borderRadius: 10,
    alignItems: 'center',
    marginRight: 8,
  },
  btnSecondaryTxt: {
    color: '#111827',
    fontWeight: '700',
  },

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
  ghost: { color: '#6B7280', fontSize: 12 },

  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
  },
});
