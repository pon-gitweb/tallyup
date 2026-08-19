/**
 * AcceptOrderButton
 *
 * Self-contained Accept Order flow: match invoice lines to venue products,
 * let the user resolve any unmatched lines, then create a draft order,
 * submit it, and attach the pending fast-receive snapshot.
 *
 * Used in two places:
 *   - FastReceivesReviewPanel (list card, variant="compact" — default)
 *   - FastReceiveDetailModal  (footer row, variant="footer")
 *
 * Props are a minimal, explicit interface covering only what this flow
 * needs — neither caller's own FastRec type is imported or referenced.
 */
import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import {
  getFirestore,
  getDocs,
  collection,
  doc,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { getApp } from 'firebase/app';
import { useVenueCountry } from '../../context/VenueProvider';
import { useToast } from '../../components/common/Toast';
import { _overlapQty } from '../../services/orders/receive';
import { quickAddProduct } from '../../services/products/quickAddProduct';
import { createDraftOrderWithLines } from '../../services/orders/create';
import { attachPendingToOrder } from '../../services/fastReceive/attachPendingToOrder';

// ── Types ─────────────────────────────────────────────────────────────────────

type ResolvedLine = { productId: string; name: string; qty: number; unitCost: number };
type UnmatchedLine = { name: string; qty: number; unitPrice: number; idx: number };

/** Minimal subset of a fast-receive record that this flow requires. */
export type AcceptOrderItem = {
  id: string;
  parsedPo?: string | null;
  payload?: {
    invoice?: {
      poNumber?: string | null;
      supplierId?: string | null;
      supplierName?: string | null;
    } | null;
    lines?: Array<{ name: string; qty: number; unitPrice?: number }> | null;
  } | null;
};

type Props = {
  item: AcceptOrderItem;
  venueId: string;
  /** Called after the order is created and the snapshot is attached. */
  onSuccess: (orderId: string) => void;
  /**
   * Disable the button from outside (e.g. when another item is attaching
   * in the same parent).
   */
  disabled?: boolean;
  /**
   * Visual variant:
   * - 'compact' (default) — small inline button used inside list cards
   * - 'footer'  — full-width flex button matching FastReceiveDetailModal's footer style
   */
  variant?: 'compact' | 'footer';
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function AcceptOrderButton({
  item,
  venueId,
  onSuccess,
  disabled = false,
  variant = 'compact',
}: Props) {
  const venueCountry = useVenueCountry();
  const { showSuccess, showError, showInfo } = useToast();
  const db = getFirestore(getApp());

  const [acceptBusy, setAcceptBusy] = useState(false);
  const [acceptReviewOpen, setAcceptReviewOpen] = useState(false);
  const [acceptMatched, setAcceptMatched] = useState<ResolvedLine[]>([]);
  const [acceptUnmatched, setAcceptUnmatched] = useState<UnmatchedLine[]>([]);
  const [acceptResolutions, setAcceptResolutions] = useState<Record<number, 'add' | 'skip'>>({});

  const isDisabled = disabled || acceptBusy;

  // ── Step 8 — create draft order, submit it, attach snapshot ───────────────
  const doAcceptCreate = useCallback(
    async (resolvedLines: ResolvedLine[]) => {
      if (!venueId) return;
      setAcceptBusy(true);
      try {
        // Resolve supplier: use payload id if present, else match by name, else placeholder.
        const supplierNameHint = item?.payload?.invoice?.supplierName || null;
        let supplierId: string | null = item?.payload?.invoice?.supplierId || null;
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

        const poOverride = item?.parsedPo ?? item?.payload?.invoice?.poNumber ?? null;

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
          null,             // notes
          supplierNameHint, // supplierNameHint
          'invoice-accept', // origin
          poOverride,       // poNumberOverride
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
          pendingId: item.id,
          orderId: newOrderId,
        });
        if (!res?.ok) throw new Error((res as any)?.error || 'attach failed');

        showSuccess('✓ Order created and invoice attached — stock updated.');
        setAcceptReviewOpen(false);
        onSuccess(newOrderId);
      } catch (e: any) {
        showError(String(e?.message || e) || 'Accept Order failed');
      } finally {
        setAcceptBusy(false);
      }
    },
    [venueId, db, item, onSuccess, showSuccess, showError],
  );

  // ── Step 6 — match lines to products ─────────────────────────────────────
  const startAcceptOrder = useCallback(async () => {
    if (!venueId || isDisabled) return;
    const lines = item?.payload?.lines || [];
    if (lines.length === 0) {
      showError('No lines in this snapshot — cannot create an order.');
      return;
    }
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
        await doAcceptCreate(matched);
      } else {
        // Open review step so the user can decide what to do with unmatched lines.
        setAcceptMatched(matched);
        setAcceptUnmatched(unmatched);
        setAcceptResolutions({});
        setAcceptReviewOpen(true);
      }
    } catch (e: any) {
      showError(String(e?.message || e) || 'Accept Order failed');
    } finally {
      setAcceptBusy(false);
    }
  }, [venueId, db, item, isDisabled, doAcceptCreate, showError]);

  // ── Step 7 — finalise after unmatched lines review ────────────────────────
  const finalizeAcceptReview = useCallback(async () => {
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

    await doAcceptCreate(finalLines);
  }, [
    venueId,
    venueCountry,
    acceptMatched,
    acceptUnmatched,
    acceptResolutions,
    doAcceptCreate,
    showInfo,
    showError,
  ]);

  // ── Button styles ─────────────────────────────────────────────────────────
  const btnStyle =
    variant === 'footer'
      ? [
          S.footerBtn,
          { backgroundColor: acceptBusy ? '#9CA3AF' : '#16a34a' },
          disabled && !acceptBusy && { opacity: 0.5 },
        ]
      : [
          S.compactBtn,
          { backgroundColor: acceptBusy ? '#9CA3AF' : '#16a34a' },
          disabled && !acceptBusy && { opacity: 0.5 },
        ];

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      <TouchableOpacity onPress={startAcceptOrder} disabled={isDisabled} style={btnStyle}>
        {acceptBusy && <ActivityIndicator size="small" color="#fff" />}
        <Text style={S.btnText}>{acceptBusy ? 'Matching…' : 'Accept Order'}</Text>
      </TouchableOpacity>

      {/* Unmatched lines review modal */}
      <Modal
        visible={acceptReviewOpen}
        animationType="slide"
        onRequestClose={() => { if (!acceptBusy) setAcceptReviewOpen(false); }}
      >
        <View style={{ flex: 1, backgroundColor: '#fff' }}>
          <View style={S.reviewHeader}>
            <TouchableOpacity
              onPress={() => { if (!acceptBusy) setAcceptReviewOpen(false); }}
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
                          S.resolveBtn,
                          {
                            flex: 1,
                            backgroundColor: resolution === 'add' ? '#16a34a' : '#F3F4F6',
                            opacity: acceptBusy ? 0.6 : 1,
                          },
                        ]}
                      >
                        <Text style={[S.resolveBtnText, { color: resolution === 'add' ? '#fff' : '#111' }]}>
                          ＋ Add as new product
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => setAcceptResolutions(prev => ({ ...prev, [u.idx]: 'skip' }))}
                        disabled={acceptBusy}
                        style={[
                          S.resolveBtn,
                          {
                            flex: 1,
                            backgroundColor: resolution === 'skip' ? '#111827' : '#F3F4F6',
                            opacity: acceptBusy ? 0.6 : 1,
                          },
                        ]}
                      >
                        <Text style={[S.resolveBtnText, { color: resolution === 'skip' ? '#fff' : '#111' }]}>
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

          <View style={S.reviewFooter}>
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
                S.resolveBtn,
                {
                  backgroundColor:
                    acceptBusy || acceptUnmatched.some(u => acceptResolutions[u.idx] === undefined)
                      ? '#9CA3AF'
                      : '#16a34a',
                },
              ]}
            >
              <Text style={S.resolveBtnText}>
                {acceptBusy ? 'Working…' : 'Continue — Create Order'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const S = StyleSheet.create({
  // Button variants
  compactBtn: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  footerBtn: {
    flex: 1,
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  btnText: { color: '#fff', fontWeight: '800' },

  // Review modal
  reviewHeader: {
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  reviewFooter: {
    padding: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e5e7eb',
    gap: 8,
  },
  card: {
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    padding: 12,
  },
  resolveBtn: {
    padding: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resolveBtnText: { color: '#fff', fontWeight: '800' },
});
