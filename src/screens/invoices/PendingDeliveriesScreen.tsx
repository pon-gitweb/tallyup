import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator, StyleSheet, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getFirestore, collection, query, where, orderBy, onSnapshot, getDocs, limit } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { getApp } from 'firebase/app';
import { useColours, useTheme } from '../../context/ThemeContext';
import { useVenueId } from '../../context/VenueProvider';
import { useToast } from '../../components/common/Toast';
import type { PendingDeliveryDoc } from '../../types/invoices';

type PendingDelivery = PendingDeliveryDoc & { id: string };

export default function PendingDeliveriesScreen({ navigation }: any) {
  const c = useColours();
  const { theme } = useTheme();
  const venueId = useVenueId();
  const { showSuccess, showError, showInfo } = useToast();
  const [deliveries, setDeliveries] = useState<PendingDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [pickerFor, setPickerFor] = useState<PendingDelivery | null>(null);
  const [invoiceOptions, setInvoiceOptions] = useState<any[]>([]);
  const [matching, setMatching] = useState(false);

  useEffect(() => {
    if (!venueId) return;
    const db = getFirestore();
    const unsub = onSnapshot(
      query(
        collection(db, 'venues', venueId, 'pendingDeliveries'),
        where('status', '==', 'awaiting_invoice'),
        orderBy('createdAt', 'desc')
      ),
      snap => {
        setDeliveries(snap.docs.map(d => ({ id: d.id, ...d.data() } as PendingDelivery)));
        setLoading(false);
      },
      err => {
        console.error('[PendingDeliveries]', err);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [venueId]);

  async function openMatchPicker(delivery: PendingDelivery) {
    if (!venueId) return;
    try {
      const db = getFirestore();
      const invoicesQuery = delivery.supplierId
        ? query(
            collection(db, 'venues', venueId, 'invoices'),
            where('supplierId', '==', delivery.supplierId),
            orderBy('createdAt', 'desc'),
            limit(10)
          )
        : query(
            collection(db, 'venues', venueId, 'invoices'),
            orderBy('createdAt', 'desc'),
            limit(10)
          );
      const snap = await getDocs(invoicesQuery);
      setInvoiceOptions(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setPickerFor(delivery);
    } catch (e) {
      showError('Could not load invoices.');
    }
  }

  async function confirmMatch(invoiceDocId: string) {
    if (!venueId || !pickerFor) return;
    setMatching(true);
    try {
      const auth = getAuth();
      const idToken = await auth.currentUser?.getIdToken();
      const region = 'us-central1';
      const projectId = (getApp() as any)?.options?.projectId || 'tallyup-f1463';
      const url = `https://${region}-${projectId}.cloudfunctions.net/ocrInvoicePhoto`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          data: {
            venueId,
            confirmDeliveryMatch: true,
            deliveryId: pickerFor.id,
            invoiceDocId,
          },
        }),
      });
      const json = await res.json().catch(() => ({} as any));
      if (!res.ok) throw new Error(json?.error?.message || json?.message || `HTTP ${res.status}`);
      showSuccess('Delivery matched to invoice. Costs updated.');
      setPickerFor(null);
    } catch (e: any) {
      showError(e?.message || 'Could not match delivery.');
    } finally {
      setMatching(false);
    }
  }

  function renderItem({ item }: { item: PendingDelivery }) {
    const isPackingSlip = item.type === 'packing_slip';
    return (
      <View style={[styles.card, { backgroundColor: c.surface || '#ffffff' }]}>
        <View style={styles.cardHeader}>
          <Text style={styles.icon}>{isPackingSlip ? '📦' : '🚚'}</Text>
          <View style={{ flex: 1 }}>
            <Text style={[styles.supplierName, { color: c.missionSlate || '#3b3f4a', fontFamily: theme.fontBodySemiBold }]}>
              {item.supplierName || 'Unknown supplier'}
            </Text>
            <Text style={[styles.meta, { color: c.slateMid || '#6b7280', fontFamily: theme.fontBody }]}>
              {isPackingSlip ? 'Packing slip' : 'Delivery note'}
              {item.deliveryDate ? ` · ${item.deliveryDate}` : ''}
              {item.packingSlipRef ? ` · Ref ${item.packingSlipRef}` : ''}
            </Text>
          </View>
        </View>

        {isPackingSlip && (
          <Text style={[styles.detail, { color: c.slateMid || '#6b7280', fontFamily: theme.fontBody }]}>
            {item.lines?.length || 0} line{item.lines?.length === 1 ? '' : 's'} received — stock already updated
            {item.provisionalCost ? ` · Provisional cost $${Number(item.provisionalCost).toFixed(2)}` : ''}
          </Text>
        )}

        <View style={styles.actions}>
          {isPackingSlip ? (
            <>
              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: c.deepBlue || '#1b4f72' }]}
                onPress={() => openMatchPicker(item)}
              >
                <Text style={[styles.actionBtnText, { fontFamily: theme.fontBodySemiBold }]}>Match to invoice</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionBtnOutline, { borderColor: c.border || '#e5e7eb' }]}
                onPress={() => navigation.navigate('Orders')}
              >
                <Text style={[styles.actionBtnOutlineText, { color: c.slateMid || '#6b7280', fontFamily: theme.fontBody }]}>
                  Upload invoice
                </Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: c.deepBlue || '#1b4f72' }]}
                onPress={() => navigation.navigate('Orders')}
              >
                <Text style={[styles.actionBtnText, { fontFamily: theme.fontBodySemiBold }]}>Match to order</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionBtnOutline, { borderColor: c.border || '#e5e7eb' }]}
                onPress={() => showInfo('Record this delivery against an order or invoice when it arrives.')}
              >
                <Text style={[styles.actionBtnOutlineText, { color: c.slateMid || '#6b7280', fontFamily: theme.fontBody }]}>
                  Enter manually
                </Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={[styles.loading, { backgroundColor: c.oat || '#f5f3ee' }]}>
        <ActivityIndicator color={c.deepBlue || '#1b4f72'} />
      </View>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.oat || '#f5f3ee' }]} edges={['top', 'left', 'right']}>
      <FlatList
        data={deliveries}
        keyExtractor={d => d.id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <Text style={[styles.heading, { color: c.missionSlate || '#3b3f4a', fontFamily: theme.fontTitle }]}>
            Pending Deliveries
          </Text>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>✓</Text>
            <Text style={[styles.emptyText, { color: c.slateMid || '#6b7280', fontFamily: theme.fontBody }]}>
              No deliveries awaiting invoice.
            </Text>
          </View>
        }
      />

      <Modal visible={!!pickerFor} transparent animationType="slide" onRequestClose={() => setPickerFor(null)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: c.surface || '#ffffff' }]}>
            <Text style={[styles.modalTitle, { color: c.missionSlate || '#3b3f4a', fontFamily: theme.fontBodySemiBold }]}>
              Match to invoice
            </Text>
            {invoiceOptions.length === 0 ? (
              <Text style={[styles.detail, { color: c.slateMid || '#6b7280', fontFamily: theme.fontBody }]}>
                No recent invoices found for this supplier.
              </Text>
            ) : (
              <FlatList
                data={invoiceOptions}
                keyExtractor={i => i.id}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={[styles.invoiceOption, { borderColor: c.border || '#e5e7eb' }]}
                    disabled={matching}
                    onPress={() => confirmMatch(item.id)}
                  >
                    <Text style={[styles.invoiceOptionText, { color: c.missionSlate || '#3b3f4a', fontFamily: theme.fontBody }]}>
                      {item.invoiceNumber || 'Invoice'} — {item.supplierName || ''} {item.invoiceDate ? `(${item.invoiceDate})` : ''}
                    </Text>
                    {item.totalAmount != null && (
                      <Text style={[styles.invoiceOptionAmount, { color: c.slateMid || '#6b7280', fontFamily: theme.fontBody }]}>
                        ${Number(item.totalAmount).toFixed(2)}
                      </Text>
                    )}
                  </TouchableOpacity>
                )}
              />
            )}
            <TouchableOpacity style={styles.modalClose} onPress={() => setPickerFor(null)} disabled={matching}>
              {matching ? (
                <ActivityIndicator color={c.deepBlue || '#1b4f72'} />
              ) : (
                <Text style={[styles.modalCloseText, { color: c.slateMid || '#6b7280', fontFamily: theme.fontBody }]}>Cancel</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: 16, paddingBottom: 40 },
  heading: { fontSize: 26, marginBottom: 16 },
  card: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 },
  icon: { fontSize: 20, marginRight: 10 },
  supplierName: { fontSize: 15, marginBottom: 2 },
  meta: { fontSize: 13 },
  detail: { fontSize: 13, marginBottom: 12 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  actionBtn: {
    flex: 1,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnText: { color: '#ffffff', fontSize: 14 },
  actionBtnOutline: {
    flex: 1,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  actionBtnOutlineText: { fontSize: 14 },
  empty: { alignItems: 'center', padding: 48 },
  emptyIcon: { fontSize: 36, color: '#2d6a4f', marginBottom: 12 },
  emptyText: { fontSize: 15 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalCard: { borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20, maxHeight: '70%' },
  modalTitle: { fontSize: 18, marginBottom: 12 },
  invoiceOption: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  invoiceOptionText: { fontSize: 14, flex: 1 },
  invoiceOptionAmount: { fontSize: 13, marginLeft: 8 },
  modalClose: { alignItems: 'center', paddingVertical: 12, marginTop: 8 },
  modalCloseText: { fontSize: 15 },
});
