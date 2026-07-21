// @ts-nocheck
import React, { useCallback, useMemo, useState, useEffect } from 'react';
import { getFirestore, updateDoc, getDocs, collection, doc, query, orderBy, limit, serverTimestamp } from 'firebase/firestore';
import { OrdersService } from '../../domain/orders';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Modal, TextInput } from 'react-native';
import { getApp } from 'firebase/app';
import { useVenueId } from '../../context/VenueProvider';
import { useToast } from '../../components/common/Toast';
import { useConfirmModal } from '../../components/common/useConfirmModal';

import { tryAttachToOrderOrSavePending } from '../../services/fastReceive/attachToOrder';
import { attachPendingToOrder } from '../../services/fastReceive/attachPendingToOrder';
import FastReceiveDetailModal from './FastReceiveDetailModal';

type FastRec = {
  id: string;
  source?: 'csv' | 'pdf' | 'manual' | 'photo' | string;
  storagePath?: string;
  parsedPo?: string | null;
  status?: 'pending' | 'attached' | 'reconciled';
  createdAt?: any;
  payload?: any;
};

export default function FastReceivesReviewPanel({ onClose }: { onClose: () => void }) {
  const venueId = useVenueId();
  const { showSuccess, showError, showInfo } = useToast();
  const { confirm, modal } = useConfirmModal();
  const db = getFirestore(getApp());
  const [rows, setRows] = useState<FastRec[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Detail modal
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailItem, setDetailItem] = useState<FastRec | null>(null);

  // Edit-PO modal
  const [editOpen, setEditOpen] = useState(false);
  const [editItem, setEditItem] = useState<FastRec | null>(null);
  const [editPo, setEditPo] = useState<string>('');
  const [editBusy, setEditBusy] = useState(false);

  // Attach chooser modal
  const [chooserOpen, setChooserOpen] = useState(false);
  const [chooserFor, setChooserFor] = useState<FastRec | null>(null);
  const [orders, setOrders] = useState<any[]>([]);
  const [ordersBusy, setOrdersBusy] = useState(false);

  const [refreshBusy, setRefreshBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      if (!venueId) return;
      const qy = query(
        collection(db, 'venues', venueId, 'fastReceives'),
        orderBy('createdAt', 'desc'),
        limit(200)
      );
      const snap = await getDocs(qy);
      const out: FastRec[] = [];
      snap.forEach(d => out.push({ id: d.id, ...(d.data() as any) }));
      setRows(out);
    } catch (e) {
      if (__DEV__) console.log('[FastReceivesReviewPanel] load failed', e);
    }
  }, [db, venueId]);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  const items = useMemo(() => rows, [rows]);

  const summary = useMemo(() => {
    const total = items.length;
    let pending = 0;
    let photos = 0;
    let attached = 0;
    let reconciled = 0;
    for (const it of items) {
      const st = (it.status || 'pending') as string;
      if (st === 'pending') pending += 1;
      if (st === 'attached') attached += 1;
      if (st === 'reconciled') reconciled += 1;
      const src = (it.source || it?.payload?.invoice?.source || '').toString().toLowerCase();
      if (src === 'photo') photos += 1;
    }
    return { total, pending, photos, attached, reconciled };
  }, [items]);

  const tryAttach = useCallback(
    async (it: FastRec) => {
      try {
        if (!venueId) throw new Error('No venue');
        if (!it?.payload) throw new Error('No snapshot payload to attach');
        setBusyId(it.id);

        const result = await tryAttachToOrderOrSavePending({
          venueId,
          parsed: {
            invoice: {
              poNumber: it?.parsedPo ?? it?.payload?.invoice?.poNumber ?? null,
              source: (it?.source || it?.payload?.invoice?.source || 'unknown') as any,
              storagePath: it?.storagePath || it?.payload?.invoice?.storagePath || '',
            },
            lines: it?.payload?.lines || [],
            confidence: it?.payload?.confidence ?? null,
            warnings: it?.payload?.warnings ?? [],
          },
          storagePath: it?.storagePath || '',
          noPendingFallback: true,
        });

        if (result.attached && result.orderId) {
          showSuccess(`✓ Linked to order ${result.orderId} and sent for reconciliation`);
          await load();
        } else {
          showInfo('No submitted order matched this PO yet. You can edit the PO, or attach to a specific order.');
        }
      } catch (e: any) {
        showError(String(e?.message || e) || 'Attach failed');
      } finally {
        setBusyId(null);
      }
    },
    [venueId, load]
  );

  const openDetails = useCallback((it: FastRec) => {
    setDetailItem(it);
    setDetailOpen(true);
  }, []);
  const closeDetails = useCallback(() => {
    setDetailOpen(false);
    setDetailItem(null);
  }, []);
  const onAttachedFromDetail = useCallback(
    async (_orderId: string) => {
      setDetailOpen(false);
      setDetailItem(null);
      await load();
    },
    [load]
  );

  const openEditPo = useCallback((it: FastRec) => {
    const currentPo = (it?.parsedPo ?? it?.payload?.invoice?.poNumber ?? '') as string;
    setEditItem(it);
    setEditPo(String(currentPo || ''));
    setEditOpen(true);
  }, []);
  const closeEditPo = useCallback(() => {
    setEditOpen(false);
    setEditItem(null);
    setEditPo('');
  }, []);
  const saveEditPo = useCallback(
    async () => {
      try {
        if (!venueId) throw new Error('No venue selected');
        if (!editItem) throw new Error('No snapshot selected');
        const raw = (editPo ?? '').trim();
        const cleaned = raw.replace(/[^A-Za-z0-9\-\s\/]/g, '').slice(0, 64);
        setEditBusy(true);
        const ref = doc(db, 'venues', venueId, 'fastReceives', editItem.id);
        await updateDoc(ref, { parsedPo: cleaned || null, updatedAt: serverTimestamp() });
        showSuccess(`✓ PO updated to "${cleaned || '—'}" — you can now Try Attach`);
        closeEditPo();
        await load();
      } catch (e: any) {
        showError(String(e?.message || e) || 'Save failed');
      } finally {
        setEditBusy(false);
      }
    },
    [venueId, db, editItem, editPo, load, closeEditPo]
  );

  const openChooser = useCallback(
    async (it: FastRec) => {
      try {
        setChooserFor(it);
        setChooserOpen(true);
        setOrdersBusy(true);
        const list = await OrdersService.listSubmittedOrders(venueId, 200);
        setOrders(list);
      } catch (e: any) {
        showError(String(e?.message || e) || 'Load orders failed');
      } finally {
        setOrdersBusy(false);
      }
    },
    [venueId]
  );

  const closeChooser = useCallback(() => {
    setChooserOpen(false);
    setChooserFor(null);
    setOrders([]);
  }, []);

  const attachToOrder = useCallback(
    async (orderId: string) => {
      if (!chooserFor) return;
      try {
        const res = await attachPendingToOrder({
          venueId,
          pendingId: chooserFor.id,
          orderId,
        });
        if (!res?.ok) throw new Error(res?.error || 'attach failed');
        showSuccess('✓ Invoice attached and sent for reconciliation');
        closeChooser();
        await load();
      } catch (e: any) {
        showError(String(e?.message || e) || 'Attach failed');
      }
    },
    [venueId, chooserFor, load, closeChooser]
  );

  const onRefreshPress = useCallback(async () => {
    try {
      setRefreshBusy(true);
      await load();
    } finally {
      setRefreshBusy(false);
    }
  }, [load]);

  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      <View
        style={{
          padding: 16,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: '#e5e7eb',
        }}
      >
        <Text style={{ fontSize: 18, fontWeight: '900' }}>Fast Receives (Pending)</Text>
        <Text style={{ color: '#6B7280', marginTop: 4 }}>
          Review snapshots, edit PO if needed, and attach to submitted orders.
        </Text>
      </View>

      {/* Summary strip + refresh – text horizontally scrollable */}
      <View
        style={{
          paddingHorizontal: 16,
          paddingVertical: 8,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: '#e5e7eb',
          flexDirection: 'row',
          alignItems: 'center',
        }}
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingRight: 8 }}
        >
          <Text style={{ color: '#4B5563', fontSize: 12 }}>
            Total {summary.total} · Pending {summary.pending} · Photos {summary.photos} · Attached {summary.attached} ·
            Reconciled {summary.reconciled}
          </Text>
        </ScrollView>
        <TouchableOpacity
          onPress={onRefreshPress}
          disabled={refreshBusy}
          style={{
            paddingHorizontal: 10,
            paddingVertical: 6,
            borderRadius: 999,
            backgroundColor: '#F3F4F6',
            opacity: refreshBusy ? 0.7 : 1,
          }}
        >
          <Text style={{ fontSize: 12, fontWeight: '800', color: '#111827' }}>
            {refreshBusy ? 'Refreshing…' : 'Refresh'}
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={{ flex: 1 }}>
        <View style={{ padding: 16, gap: 10 }}>
          {items.length === 0 ? (
            <Text style={{ color: '#94A3B8' }}>No pending fast receives.</Text>
          ) : (
            items.map(it => {
              const ts = it.createdAt?.toDate ? it.createdAt.toDate() : null;
              const dateLabel = ts
                ? ts.toLocaleDateString() + ' ' + ts.toLocaleTimeString()
                : 'Unknown date';
              return (
                <View key={it.id} style={S.card}>
                  <Text style={S.title}>{dateLabel}</Text>
                  <Text style={S.sub}>
                    Source: {it.source || '—'} · Status: {it.status || 'pending'}
                  </Text>

                  <View style={{ marginTop: 10 }}>
                    <TouchableOpacity
                      onPress={() => openDetails(it)}
                      style={{
                        paddingVertical: 10,
                        paddingHorizontal: 12,
                        borderRadius: 10,
                        backgroundColor: '#0ea5e9',
                        alignSelf: 'flex-start',
                      }}
                    >
                      <Text style={{ color: '#fff', fontWeight: '800' }}>View Details</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })
          )}
        </View>
      </ScrollView>

      <View
        style={{
          padding: 16,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: '#e5e7eb',
        }}
      >
        <TouchableOpacity
          onPress={onClose}
          style={{
            padding: 14,
            borderRadius: 12,
            backgroundColor: '#F3F4F6',
          }}
        >
          <Text style={{ color: '#111', fontWeight: '800', textAlign: 'center' }}>Close</Text>
        </TouchableOpacity>
      </View>

      <FastReceiveDetailModal
        visible={detailOpen}
        item={detailItem}
        onClose={closeDetails}
        onAttached={onAttachedFromDetail}
        onEditPo={detailItem ? () => openEditPo(detailItem) : undefined}
        onAttachToSpecificOrder={detailItem ? () => openChooser(detailItem) : undefined}
      />

      {/* Edit-PO modal */}
      <Modal visible={editOpen} transparent animationType="fade" onRequestClose={closeEditPo}>
        <View style={S.modalWrap}>
          <View style={S.modalCard}>
            <Text style={S.modalTitle}>Edit PO Number</Text>
            <Text
              style={{
                color: '#6B7280',
                marginTop: 4,
              }}
            >
              Only the PO is editable here. This helps match a Submitted order.
            </Text>
            <TextInput
              value={editPo}
              onChangeText={setEditPo}
              placeholder="PO Number"
              autoCapitalize="characters"
              style={S.input}
            />
            <View
              style={{
                flexDirection: 'row',
                gap: 8,
                marginTop: 10,
              }}
            >
              <TouchableOpacity
                disabled={editBusy}
                onPress={saveEditPo}
                style={[S.btn, { backgroundColor: '#111' }]}
              >
                <Text style={S.btnText}>{editBusy ? 'Saving…' : 'Save'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                disabled={editBusy}
                onPress={closeEditPo}
                style={[S.btn, { backgroundColor: '#F3F4F6' }]}
              >
                <Text style={[S.btnText, { color: '#111' }]}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Attach chooser */}
      <Modal visible={chooserOpen} animationType="slide" onRequestClose={closeChooser}>
        <View
          style={{
            flex: 1,
            backgroundColor: '#fff',
          }}
        >
          <View
            style={{
              padding: 16,
              borderBottomWidth: StyleSheet.hairlineWidth,
              borderBottomColor: '#e5e7eb',
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <TouchableOpacity onPress={closeChooser}>
              <Text
                style={{
                  fontSize: 18,
                  color: '#2563EB',
                }}
              >
                ‹ Back
              </Text>
            </TouchableOpacity>
            <Text
              style={{
                fontSize: 18,
                fontWeight: '800',
              }}
            >
              Choose Submitted Order
            </Text>
            <View style={{ width: 60 }} />
          </View>

          <ScrollView style={{ flex: 1 }}>
            <View style={{ padding: 16, gap: 10 }}>
              {ordersBusy ? (
                <Text style={{ color: '#6B7280' }}>Loading orders…</Text>
              ) : orders.length === 0 ? (
                <Text style={{ color: '#94A3B8' }}>No submitted orders found.</Text>
              ) : (
                orders.map(o => {
                  const when = o.createdAt?.toDate ? o.createdAt.toDate().toISOString() : '—';
                  return (
                    <TouchableOpacity key={o.id} onPress={() => attachToOrder(o.id)} style={S.orderRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontWeight: '800' }}>PO {o.poNumber || '—'}</Text>
                        <Text style={{ color: '#6B7280', marginTop: 2 }}>{o.supplierName || '—'}</Text>
                        <Text style={{ color: '#9CA3AF', marginTop: 2, fontSize: 12 }}>{when}</Text>
                      </View>
                      <Text style={{ fontSize: 20, color: '#94A3B8' }}>›</Text>
                    </TouchableOpacity>
                  );
                })
              )}
            </View>
          </ScrollView>

          <View
            style={{
              padding: 16,
              borderTopWidth: StyleSheet.hairlineWidth,
              borderTopColor: '#e5e7eb',
            }}
          >
            <TouchableOpacity
              onPress={closeChooser}
              style={{
                padding: 14,
                borderRadius: 12,
                backgroundColor: '#F3F4F6',
              }}
            >
              <Text style={{ color: '#111', fontWeight: '800', textAlign: 'center' }}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      {modal}
    </View>
  );
}

const S = StyleSheet.create({
  card: {
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    padding: 12,
  },
  title: { fontWeight: '800' },
  sub: { color: '#6B7280', marginTop: 4 },
  modalWrap: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCard: {
    width: '90%',
    maxWidth: 420,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  modalTitle: { fontSize: 18, fontWeight: '900' },
  input: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    padding: 12,
    backgroundColor: '#fff',
  },
  btn: { flex: 1, padding: 12, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  btnText: { color: '#fff', fontWeight: '800' },
  orderRow: {
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#F9FAFB',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
});
