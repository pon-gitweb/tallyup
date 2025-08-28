import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Alert, TouchableOpacity, FlatList, Switch, TextInput } from 'react-native';
import { useVenueId } from '../../context/VenueProvider';
import { buildSuggestedOrdersInMemory, createDraftOrderWithLines, OrderLine } from '../../services/orders';
import { listSuppliers, Supplier } from '../../services/suppliers';
import { listProducts } from '../../services/products';
import SupplierDraftButton from '../../components/SupplierDraftButton';
import { useNavigation } from '@react-navigation/native';
import type { DraftLine } from '../../services/orderDrafts';

type Group = { supplierId: string; supplier?: Supplier; lines: OrderLine[] };

export default function SuggestedOrderScreen() {
  const nav = useNavigation<any>();
  const venueId = useVenueId();
  const [loading, setLoading] = useState(true);
  const [roundToPack, setRoundToPack] = useState(true);
  const [deliveryDate, setDeliveryDate] = useState<string>(''); // YYYY-MM-DD
  const [groups, setGroups] = useState<Group[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [productsCount, setProductsCount] = useState<number>(0);

  async function load() {
    if (!venueId) { setGroups([]); setLoading(false); return; }
    try {
      setLoading(true);
      const [suggested, suppliersArr, productsArr] = await Promise.all([
        buildSuggestedOrdersInMemory(venueId),
        listSuppliers(venueId),
        listProducts(venueId),
      ]);
      setSuppliers(suppliersArr);
      setProductsCount(productsArr.length);

      const gs: Group[] = Object.keys(suggested.bySupplier).map(sid => ({
        supplierId: sid,
        supplier: suppliersArr.find(s => s.id === sid),
        lines: suggested.bySupplier[sid],
      }));
      gs.sort((a, b) => (a.supplier?.name || '').localeCompare(b.supplier?.name || ''));
      setGroups(gs);
    } catch (e: any) {
      console.log('[SuggestedOrders] load error', e?.message);
      Alert.alert('Load Failed', e?.message || 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [venueId]);

  const visibleGroups = useMemo(() => {
    if (!roundToPack) return groups;
    return groups.map(g => ({
      ...g,
      lines: g.lines.map(l => {
        if (!l.packSize || l.packSize <= 1) return l;
        const q = Number(l.qty) || 0;
        const ps = Number(l.packSize) || 1;
        const r = Math.ceil(q / ps) * ps;
        return { ...l, qty: r };
      }),
    }));
  }, [groups, roundToPack]);

  function parseDelivery(d: string): Date | null {
    if (!d) return null;
    // Simple YYYY-MM-DD check
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d.trim());
    if (!m) return null;
    const dt = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00`);
    return isNaN(dt.getTime()) ? null : dt;
  }

  async function createDrafts() {
    if (!venueId) return;
    if (visibleGroups.length === 0) {
      Alert.alert('No Suggestions', 'There are no suggested lines to create.');
      return;
    }
    try {
      for (const g of visibleGroups) {
        if (!g.lines.length) continue;
        await createDraftOrderWithLines(
          venueId,
          g.supplierId,
          g.lines,
          deliveryDate ? `Requested delivery: ${deliveryDate}` : null
        );
      }
      Alert.alert('Drafts Created', 'Suggested orders saved as drafts under Orders.');
    } catch (e: any) {
      Alert.alert('Create Failed', e?.message || 'Unknown error');
    }
  }

  // Helpful empty-state reasoning
  const emptyReason = useMemo(() => {
    if (loading) return '';
    if (!venueId) return 'You are not attached to a venue.';
    if (suppliers.length === 0) return 'No suppliers found.\nAdd suppliers in Settings → Manage Suppliers.';
    if (productsCount === 0) return 'No products found.\nAdd products (with par levels) in Settings → Manage Products.';
    if (groups.length === 0) {
      return 'No suggestions were generated.\nCheck that products have par levels set, and at least a default supplier or price list.';
    }
    return '';
  }, [loading, venueId, suppliers.length, productsCount, groups.length]);

  if (loading) return (<View style={styles.center}><ActivityIndicator /><Text>Building suggestions…</Text></View>);

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Suggested Orders</Text>

      <View style={styles.row}>
        <View style={styles.card}>
          <Text style={styles.label}>Round to pack</Text>
          <Switch value={roundToPack} onValueChange={setRoundToPack} />
        </View>
        <View style={[styles.card, { flex: 1 }]}>
          <Text style={styles.label}>Requested delivery (YYYY-MM-DD)</Text>
          <TextInput
            placeholder="2025-09-01"
            value={deliveryDate}
            onChangeText={setDeliveryDate}
            style={styles.input}
            autoCapitalize="none"
          />
        </View>
      </View>

      {emptyReason ? (
        <View style={[styles.card, styles.warn]}>
          <Text style={styles.warnText}>{emptyReason}</Text>
        </View>
      ) : null}

      <FlatList
        style={{ marginTop: 8 }}
        data={visibleGroups}
        keyExtractor={(g) => g.supplierId}
        ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
        renderItem={({ item: g }) => {
          // Map to DraftLine for the per-supplier draft button
          const draftLines: DraftLine[] = g.lines.map(l => ({
            productId: l.productId,
            name: l.name,
            sku: (l as any)?.sku ?? null,
            qty: Number(l.qty) || 0,
            unitCost: l.unitCost ?? null,
            packSize: l.packSize ?? null,
          }));
          const delivery = parseDelivery(deliveryDate);

          return (
            <View style={styles.group}>
              <Text style={styles.groupTitle}>{g.supplier?.name || g.supplierId}</Text>
              {g.lines.map((l) => (
                <View key={`${l.productId}`} style={styles.line}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.lineName}>{l.name}</Text>
                    <Text style={styles.sub}>
                      {l.unitCost != null ? `@ ${Number(l.unitCost).toFixed(2)}` : '@ —'}
                      {l.packSize ? ` · pack ${l.packSize}` : ''}
                    </Text>
                  </View>
                  <Text style={styles.qty}>{l.qty}</Text>
                </View>
              ))}

              <View style={{ marginTop: 8 }}>
                <SupplierDraftButton
                  venueId={venueId!}
                  supplierId={g.supplierId}
                  supplierName={g.supplier?.name || g.supplierId}
                  lines={draftLines}
                  deliveryDate={delivery}
                  onDrafted={(orderId) => nav.navigate('OrderDetail', { orderId })}
                />
              </View>
            </View>
          );
        }}
        ListEmptyComponent={<Text>No suggestions available.</Text>}
      />

      <TouchableOpacity style={styles.primary} onPress={createDrafts} disabled={visibleGroups.length === 0}>
        <Text style={styles.primaryText}>Create Draft Orders</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 16, gap: 12 },
  title: { fontSize: 22, fontWeight: '800' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  row: { flexDirection: 'row', gap: 10 },
  card: { backgroundColor: '#F2F2F7', padding: 10, borderRadius: 12, gap: 6, alignItems: 'flex-start' },
  label: { fontWeight: '700' },
  input: { borderWidth: 1, borderColor: '#D0D3D7', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, width: '100%' },
  warn: { backgroundColor: '#FFF4E5' },
  warnText: { color: '#8A5200' },
  group: { backgroundColor: '#EFEFF4', padding: 12, borderRadius: 12 },
  groupTitle: { fontWeight: '800', marginBottom: 6 },
  line: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  lineName: { fontWeight: '700' },
  sub: { opacity: 0.7 },
  qty: { fontWeight: '900', width: 56, textAlign: 'right' },
  primary: { backgroundColor: '#0A84FF', paddingVertical: 14, borderRadius: 12, alignItems: 'center', marginTop: 8 },
  primaryText: { color: 'white', fontWeight: '800' },
});
