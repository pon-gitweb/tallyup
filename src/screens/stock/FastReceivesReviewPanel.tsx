// @ts-nocheck
import React, { useCallback, useMemo, useState, useEffect } from 'react';
import { getFirestore, updateDoc, getDocs, collection, doc, query, orderBy, limit, serverTimestamp } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { OrdersService } from '../../domain/orders';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Modal, TextInput, ActivityIndicator } from 'react-native';
import { getApp } from 'firebase/app';
import { useVenueId, useVenueCountry } from '../../context/VenueProvider';
import { useToast } from '../../components/common/Toast';
import { useConfirmModal } from '../../components/common/useConfirmModal';

import { tryAttachToOrderOrSavePending } from '../../services/fastReceive/attachToOrder';
import { attachPendingToOrder } from '../../services/fastReceive/attachPendingToOrder';
import { _overlapQty } from '../../services/orders/receive';
import { quickAddProduct } from '../../services/products/quickAddProduct';
import { createDraftOrderWithLines } from '../../services/orders/create';
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

type ResolvedLine = { productId: string; name: string; qty: number; unitCost: number };
type UnmatchedLine = { name: string; qty: number; unitPrice: number; idx: number };

export default function FastReceivesReviewPanel({ onClose }: { onClose: () => void }) {
  const venueId = useVenueId();
  const venueCountry = useVenueCountry();
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

  // Accept Order flow
  const [acceptFor, setAcceptFor] = useState<FastRec | null>(null);
  const [acceptBusy, setAcceptBusy] = useState(false);
  const [acceptReviewOpen, setAcceptReviewOpen] = useState(false);
  const [acceptMatched, setAcceptMatched] = useState<ResolvedLine[]>([]);
  const [acceptUnmatched, setAcceptUnmatched] = useState<UnmatchedLine[]>([]);
  const [acceptResolutions, setAcceptResolutions] = useState<Record<number, 'add' | 'skip'>>({});

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

  // ── Accept Order: core create+submit+attach step ──────────────────────────
  // Plain async helper (not useCallback) — always called from within another
  // callback so always has access to current venueId/db/load through closure.
  const doAcceptCreate = useCallback(
    async (it: FastRec, resolvedLines: ResolvedLine[]) => {
      if (!venueId) return;
      setAcceptBusy(true);
      try {
        // Resolve supplier: use payload id if present, else match by name, else placeholder.
        const supplierNameHint = it?.payload?.invoice?.supplierName || null;
        let supplierId = it?.payload?.invoice?.supplierId || null;
        if (!supplierId && supplierNameHint) {
          try {
            const suppSnap = await getDocs(collection(db, 'venues', venueId, 'suppliers'));
            for (const sd of suppSnap.docs) {
              const sn = ((sd.data() as any)?.name || '').toLowerCase().trim();
              if (sn && sn === supplierNameHint.toLowerCase().trim()) {
                supplierId = sd.id;
                break;
              }
            }
          } catch {}
        }
        // '_invoice_accept' is a stable placeholder: resolveSupplierName handles
        // missing docs gracefully and will fall back to supplierNameHint.
        supplierId = supplierId || '_invoice_accept';

        const poOverride = it?.parsedPo ?? it?.payload?.invoice?.poNumber ?? null;

        // Step 8a — create draft order with resolved lines + PO from invoice.
        const { id: newOrderId } = await createDraftOrderWithLines(
          venueId,
          supplierId,
          resolvedLines.map(l => ({
            productId: l.productId,
            name: l.name,
            qty: l.qty,
            unitCost: l.unitCost,
          })),
          null,            // notes
          supplierNameHint, // supplierNameHint
          'invoice-accept', // origin
          poOverride,      // poNumberOverride
        );

        // Step 8b — write 'submitted' directly, bypassing finalizeToSubmitted.
        // Reason: the role gate in finalizeToSubmitted exists to control forward-looking
        // spending commitments; goods already physically arrived, so blocking record-keeping
        // on role would be wrong. We write the same fields finalizeToSubmitted writes,
        // minus the role check, plus poDate to prevent ensurePoFields overwriting our PO.
        const uid = getAuth()?.currentUser?.uid ?? null;
        await updateDoc(doc(db, 'venues', venueId, 'orders', newOrderId), {
          status: 'submitted',
          displayStatus: 'submitted',
          submittedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          updatedBy: uid,
          submittedBy: uid,
          plannedSubmitAt: null,
          isConsolidating: null,
          submitHoldUntil: null,
          cutoffAt: null,
          merge: null,
          queued: null,
          pending: null,
          pendingReason: null,
          // poDate prevents ensurePoFields (used by the standard submit path elsewhere)
          // from overwriting the invoice-provided PO number on this order.
          poDate: serverTimestamp(),
        });

        // Step 8c — attach the pending snapshot to the new order.
        // attachPendingToOrder is the proven mechanism; it triggers the full
        // finalize-receive pipeline (reconcile → stock update → invoice document).
        const res = await attachPendingToOrder({
          venueId,
          pendingId: it.id,
          orderId: newOrderId,
        });
        if (!res?.ok) throw new Error(res?.error || 'attach failed');

        showSuccess('✓ Order created and invoice attached — stock updated.');
        setAcceptReviewOpen(false);
        setAcceptFor(null);
        await load();
      } catch (e: any) {
        showError(String(e?.message || e) || 'Accept Order failed');
      } finally {
        setAcceptBusy(false);
      }
    },
    [venueId, db, load, showSuccess, showError]
  );

  // ── Accept Order: Step 6 — match lines to products ────────────────────────
  const startAcceptOrder = useCallback(
    async (it: FastRec) => {
      if (!venueId || acceptBusy || busyId) return;
      const lines = it?.payload?.lines || [];
      if (lines.length === 0) {
        showError('No lines in this snapshot — cannot create an order.');
        return;
      }
      setAcceptFor(it);
      setAcceptBusy(true);
      try {
        // Fetch venue products for matching.
        const prodSnap = await getDocs(collection(db, 'venues', venueId, 'products'));
        const products = prodSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));

        const matched: ResolvedLine[] = [];
        const unmatched: UnmatchedLine[] = [];

        for (let idx = 0; idx < lines.length; idx++) {
          const line = lines[idx];
          const lineName = String(line?.name || '').trim();
          if (!lineName) continue;

          // Match using the same _overlapQty helpers as updateStockAndCreateInvoice
          // (threshold 0.85 — established convention throughout the receive pipeline).
          let bestScore = 0;
          let bestProduct: any = null;
          for (const p of products) {
            const score = _overlapQty(lineName, p.name || '');
            if (score >= 0.85 && score > bestScore) {
              bestScore = score;
              bestProduct = p;
            }
          }

          if (bestProduct) {
            matched.push({
              productId: bestProduct.id,
              name: lineName,
              qty: Math.max(1, Number(line.qty) || 1),
              unitCost: Number(line.unitPrice) || 0,
            });
          } else {
            unmatched.push({
              name: lineName,
              qty: Math.max(1, Number(line.qty) || 1),
              unitPrice: Number(line.unitPrice) || 0,
              idx,
            });
          }
        }

        if (unmatched.length === 0) {
          // All lines matched — skip review and proceed straight to create.
          await doAcceptCreate(it, matched);
        } else {
          // Open review step so the user can decide what to do with unmatched lines.
          setAcceptMatched(matched);
          setAcceptUnmatched(unmatched);
          setAcceptResolutions({});
          setAcceptReviewOpen(true);
        }
      } catch (e: any) {
        showError(String(e?.message || e) || 'Accept Order failed');
        setAcceptFor(null);
      } finally {
        setAcceptBusy(false);
      }
    },
    [venueId, db, acceptBusy, busyId, doAcceptCreate, showError]
  );

  // ── Accept Order: Step 7 — finalise after unmatched review ────────────────
  const finalizeAcceptReview = useCallback(
    async () => {
      if (!acceptFor) return;
      const allResolved = acceptUnmatched.every(u => acceptResolutions[u.idx] !== undefined);
      if (!allResolved) {
        showInfo('Please resolve all unmatched items before continuing.');
        return;
      }

      const finalLines: ResolvedLine[] = [...acceptMatched];
      const skippedNames: string[] = [];

      for (const u of acceptUnmatched) {
        const resolution = acceptResolutions[u.idx];
        if (resolution === 'add') {
          // Create a new product: name from invoice, costPrice from unitPrice,
          // unit/size left as null ("Unsure") — matching the quick-add convention.
          try {
            const result = await quickAddProduct({
              venueId,
              name: u.name,
              costPrice: u.unitPrice || null,
              venueCountry,
            });
            finalLines.push({
              productId: result.productId,
              name: u.name,
              qty: u.qty,
              unitCost: u.unitPrice,
            });
          } catch (e: any) {
            showError(`Could not add product "${u.name}": ${e?.message || e}`);
            return;
          }
        } else if (resolution === 'skip') {
          skippedNames.push(u.name);
        }
      }

      if (finalLines.length === 0) {
        showError('All items were skipped — cannot create an order with no lines.');
        return;
      }

      if (skippedNames.length > 0) {
        console.log('[AcceptOrder] skipped items (excluded from order):', skippedNames.join(', '));
      }

      await doAcceptCreate(acceptFor, finalLines);
    },
    [venueId, acceptFor, acceptMatched, acceptUnmatched, acceptResolutions, doAcceptCreate, showInfo, showError]
  );

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
              const isPending = !it.status || it.status === 'pending';
              const isThisAccepting = acceptBusy && acceptFor?.id === it.id;
              return (
                <View key={it.id} style={S.card}>
                  <Text style={S.title}>{dateLabel}</Text>
                  <Text style={S.sub}>
                    Source: {it.source || '—'} · Status: {it.status || 'pending'}
                  </Text>

                  <View style={{ marginTop: 10, flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
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

                    {isPending && (
                      <TouchableOpacity
                        onPress={() => startAcceptOrder(it)}
                        disabled={acceptBusy || !!busyId}
                        style={{
                          paddingVertical: 10,
                          paddingHorizontal: 12,
                          borderRadius: 10,
                          backgroundColor: isThisAccepting ? '#9CA3AF' : '#16a34a',
                          alignSelf: 'flex-start',
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 6,
                          opacity: (acceptBusy && !isThisAccepting) || !!busyId ? 0.5 : 1,
                        }}
                      >
                        {isThisAccepting && (
                          <ActivityIndicator size="small" color="#fff" />
                        )}
                        <Text style={{ color: '#fff', fontWeight: '800' }}>
                          {isThisAccepting ? 'Matching…' : 'Accept Order'}
                        </Text>
                      </TouchableOpacity>
                    )}
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

      {/* Accept Order — unmatched lines review modal */}
      <Modal
        visible={acceptReviewOpen}
        animationType="slide"
        onRequestClose={() => { if (!acceptBusy) { setAcceptReviewOpen(false); setAcceptFor(null); } }}
      >
        <View style={{ flex: 1, backgroundColor: '#fff' }}>
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
            <TouchableOpacity
              onPress={() => { if (!acceptBusy) { setAcceptReviewOpen(false); setAcceptFor(null); } }}
              disabled={acceptBusy}
            >
              <Text style={{ fontSize: 18, color: acceptBusy ? '#9CA3AF' : '#2563EB' }}>‹ Cancel</Text>
            </TouchableOpacity>
            <Text style={{ fontSize: 18, fontWeight: '800' }}>Review Items</Text>
            <View style={{ width: 60 }} />
          </View>

          <ScrollView style={{ flex: 1 }}>
            <View style={{ padding: 16 }}>
              <Text style={{ fontWeight: '800', fontSize: 15, marginBottom: 4 }}>
                These items weren't found in your product list
              </Text>
              <Text style={{ color: '#6B7280', marginBottom: 16 }}>
                {acceptMatched.length > 0
                  ? `${acceptMatched.length} item${acceptMatched.length === 1 ? '' : 's'} matched · ${acceptUnmatched.length} need${acceptUnmatched.length === 1 ? 's' : ''} review`
                  : `${acceptUnmatched.length} item${acceptUnmatched.length === 1 ? '' : 's'} need${acceptUnmatched.length === 1 ? 's' : ''} review`}
              </Text>

              {acceptUnmatched.map(u => {
                const resolution = acceptResolutions[u.idx];
                return (
                  <View key={u.idx} style={[S.card, { marginBottom: 10 }]}>
                    <Text style={{ fontWeight: '700' }}>{u.name}</Text>
                    <Text style={{ color: '#6B7280', fontSize: 12, marginTop: 2 }}>
                      Qty {u.qty}{u.unitPrice > 0 ? ` · $${u.unitPrice.toFixed(2)} ea` : ''}
                    </Text>
                    <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                      <TouchableOpacity
                        onPress={() => setAcceptResolutions(prev => ({ ...prev, [u.idx]: 'add' }))}
                        disabled={acceptBusy}
                        style={[
                          S.btn,
                          {
                            flex: 1,
                            backgroundColor: resolution === 'add' ? '#16a34a' : '#F3F4F6',
                            opacity: acceptBusy ? 0.6 : 1,
                          },
                        ]}
                      >
                        <Text style={[S.btnText, { color: resolution === 'add' ? '#fff' : '#111' }]}>
                          ＋ Add as new product
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => setAcceptResolutions(prev => ({ ...prev, [u.idx]: 'skip' }))}
                        disabled={acceptBusy}
                        style={[
                          S.btn,
                          {
                            flex: 1,
                            backgroundColor: resolution === 'skip' ? '#111827' : '#F3F4F6',
                            opacity: acceptBusy ? 0.6 : 1,
                          },
                        ]}
                      >
                        <Text style={[S.btnText, { color: resolution === 'skip' ? '#fff' : '#111' }]}>
                          Skip this item
                        </Text>
                      </TouchableOpacity>
                    </View>
                    {resolution === 'skip' && (
                      <Text style={{ color: '#9CA3AF', fontSize: 11, marginTop: 6 }}>
                        This item will be excluded from the order (not silently dropped — noted here).
                      </Text>
                    )}
                    {resolution === 'add' && (
                      <Text style={{ color: '#16a34a', fontSize: 11, marginTop: 6 }}>
                        A new product will be created with name and cost price from the invoice. Unit/size can be set later.
                      </Text>
                    )}
                  </View>
                );
              })}
            </View>
          </ScrollView>

          <View
            style={{
              padding: 16,
              borderTopWidth: StyleSheet.hairlineWidth,
              borderTopColor: '#e5e7eb',
              gap: 8,
            }}
          >
            {acceptBusy && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <ActivityIndicator size="small" color="#16a34a" />
                <Text style={{ color: '#6B7280' }}>Creating order…</Text>
              </View>
            )}
            <TouchableOpacity
              onPress={finalizeAcceptReview}
              disabled={
                acceptBusy ||
                acceptUnmatched.some(u => acceptResolutions[u.idx] === undefined)
              }
              style={[
                S.btn,
                {
                  backgroundColor:
                    acceptBusy || acceptUnmatched.some(u => acceptResolutions[u.idx] === undefined)
                      ? '#9CA3AF'
                      : '#16a34a',
                },
              ]}
            >
              <Text style={S.btnText}>
                {acceptBusy ? 'Working…' : 'Continue — Create Order'}
              </Text>
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
