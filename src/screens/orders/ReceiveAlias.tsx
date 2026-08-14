// @ts-nocheck
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, FlatList } from 'react-native';
import { useToast } from '../../components/common/Toast';
import { useRoute, useNavigation } from '@react-navigation/native';
import { getApp } from 'firebase/app';
import {
  getFirestore, doc, getDoc, onSnapshot,
  collection, getDocs, writeBatch, serverTimestamp, setDoc
} from 'firebase/firestore';
import { useVenueId } from '../../context/VenueProvider';
import { useColours } from '../../context/ThemeContext';
import { captureMultiPagePhotos } from '../../services/fastReceive/captureMultiPagePhotos';
import { scanInvoicePhoto } from '../../services/fastReceive/scanInvoicePhoto';
import { reconcileInvoiceREST } from '../../services/invoices/reconcile';
import { finalizeReceiveFromPhoto } from '../../services/orders/receive';

type Line = {
  productId: string;
  name?: string | null;
  qty?: number;           // ordered qty
  receivedQty?: number;   // received for this session
};

function formatAnomaly(a: any): string {
  if (!a || typeof a !== 'object') return String(a);
  switch (a.type) {
    case 'missingOnInvoice': return `Missing from invoice: ${a.productName} (ordered ${a.orderedQty})`;
    case 'unknown':          return `Not on order: ${a.invoiceName} (qty ${a.invoiceQty})`;
    case 'qtyDiff':          return `Qty mismatch: ${a.productName} — ordered ${a.orderedQty}, invoiced ${a.invoicedQty}`;
    case 'priceChange':      return `Price change: ${a.productName} — order $${Number(a.orderUnitCost).toFixed(2)}, invoice $${Number(a.invoiceUnitPrice).toFixed(2)}`;
    default:                 return JSON.stringify(a);
  }
}

export default function ReceiveAlias() {
  const route = useRoute<any>();
  const nav = useNavigation<any>();
  const venueId = useVenueId();
  const colours = useColours();
  const { showError, showSuccess, showInfo } = useToast();

  const orderId: string | undefined = route?.params?.orderId;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // scan / preview state
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<any | null>(null);
  const [reconcilePreview, setReconcilePreview] = useState<any | null>(null);

  const [supplierName, setSupplierName] = useState<string>('Order');
  const [status, setStatus] = useState<string | undefined>(undefined);
  const [lines, setLines] = useState<Line[]>([]);

  // live order doc
  useEffect(() => {
    if (!venueId || !orderId) return;
    const db = getFirestore(getApp());
    const ref = doc(db, 'venues', venueId, 'orders', orderId);
    const unsub = onSnapshot(ref, (snap) => {
      const v = snap.data() as any;
      setSupplierName(v?.supplierName || v?.supplierId || 'Order');
      setStatus(v?.status);
    });
    return () => unsub();
  }, [venueId, orderId]);

  // load lines; prefill receivedQty with ordered qty
  useEffect(() => {
    (async () => {
      if (!venueId || !orderId) { setLoading(false); return; }
      try {
        const db = getFirestore(getApp());
        const ls = await getDocs(collection(db, 'venues', venueId, 'orders', orderId, 'lines'));
        const out: Line[] = [];
        ls.forEach(d => {
          const v = d.data() as any;
          const ordered = Number(v?.qty ?? 0);
          out.push({
            productId: v?.productId || d.id,
            name: v?.name || d.id,
            qty: ordered,
            receivedQty: Number(v?.receivedQty ?? ordered), // PREFILL from ordered
          });
        });
        out.sort((a, b) => (a.name || a.productId).localeCompare(b.name || b.productId));
        setLines(out);
      } catch (e) {
        showError((e as any)?.message ?? 'Failed to load lines.');
      } finally {
        setLoading(false);
      }
    })();
  }, [venueId, orderId]);

  // derived totals (for header)
  const totals = useMemo(() => {
    const ordered = lines.reduce((s, l) => s + Number(l.qty || 0), 0);
    const received = lines.reduce((s, l) => s + Number(l.receivedQty || 0), 0);
    const allReceived = lines.length > 0 && lines.every(l => Number(l.receivedQty || 0) >= Number(l.qty || 0));
    const anyReceived = lines.some(l => Number(l.receivedQty || 0) > 0);
    return { ordered, received, allReceived, anyReceived };
  }, [lines]);

  // UI helpers
  const bump = useCallback((productId: string, delta: number) => {
    setLines(prev => prev.map(l => {
      if (l.productId !== productId) return l;
      const ordered = Number(l.qty || 0);
      const next = Math.max(0, Math.min(ordered, Number(l.receivedQty || 0) + delta));
      return { ...l, receivedQty: next };
    }));
  }, []);

  const receiveAll = useCallback(() => {
    setLines(prev => prev.map(l => ({ ...l, receivedQty: Number(l.qty || 0) })));
  }, []);

  // persist helper (keeps submitted) or finalize (received) — no-scan path, unchanged
  const persist = useCallback(async (finalize: boolean) => {
    if (!venueId || !orderId) return;
    try {
      setSaving(true);
      const db = getFirestore(getApp());
      const orderRef = doc(db, 'venues', venueId, 'orders', orderId);
      const batch = writeBatch(db);
      const now = serverTimestamp();

      // write per-line receivedQty
      lines.forEach(l => {
        const lineRef = doc(orderRef, 'lines', l.productId);
        batch.set(lineRef, {
          productId: l.productId,
          name: l.name || l.productId,
          receivedQty: Number(l.receivedQty || 0),
          updatedAt: now
        }, { merge: true });
      });

      if (finalize) {
        batch.set(orderRef, {
          status: 'received',
          displayStatus: 'Received',
          receivedAt: now,
          updatedAt: now,
        }, { merge: true });
      } else {
        // Save without changing phase: ensure it's not draft
        batch.set(orderRef, {
          status: 'submitted',
          displayStatus: 'Submitted',
          updatedAt: now,
        }, { merge: true });
      }

      await batch.commit();

      showSuccess(finalize ? 'Order marked as Received.' : 'Saved.');
      nav.goBack(); // back to OrderDetail -> header will refresh
    } catch (e) {
      console.warn('[Receive] save error', e);
      showError((e as any)?.message ?? 'Failed to save.');
    } finally {
      setSaving(false);
    }
  }, [venueId, orderId, lines, nav]);

  // Scan invoice: capture pages → OCR → reconcile preview (non-committing)
  const scanInvoice = useCallback(async () => {
    if (scanning || saving) return;
    try {
      setScanning(true);

      const capture = await captureMultiPagePhotos();
      if (capture.permissionDenied) {
        showInfo('Camera access is required to scan an invoice.');
        return;
      }
      if (!capture.uris) return; // user canceled

      const filename = `invoice_${Date.now()}.jpg`;
      const scanned = await scanInvoicePhoto({ venueId, photoUris: capture.uris, filename });
      setScanResult(scanned);

      // Non-committing preview — lets the user review before finalizing
      const preview = await reconcileInvoiceREST(venueId, orderId, {
        invoice: {
          source: scanned.invoice.source,
          storagePath: scanned.invoice.storagePath,
          poNumber: scanned.invoice.poNumber,
        },
        lines: scanned.lines,
        confidence: scanned.confidence,
        warnings: scanned.warnings,
      });
      setReconcilePreview(preview);

      if (!preview.ok) {
        showError(preview.error || 'Reconciliation preview failed.');
      }
    } catch (e: any) {
      showError(String(e?.message || e) || 'Scan failed.');
    } finally {
      setScanning(false);
    }
  }, [venueId, orderId, scanning, saving, showInfo, showError]);

  // Complete Receiving — scan path: re-reconciles server-side, saves record, updates stock, creates invoice
  const completeScanReceiving = useCallback(async () => {
    if (!venueId || !orderId || !scanResult) return;
    try {
      setSaving(true);
      const result = await finalizeReceiveFromPhoto({
        venueId,
        orderId,
        parsed: {
          invoice: scanResult.invoice,
          lines: scanResult.lines,
          confidence: scanResult.confidence,
          warnings: scanResult.warnings,
        },
      });
      if (!result.ok) {
        showError(result.error || 'Could not complete receiving.');
        return;
      }
      showSuccess(result.priorPeriod ? (result.message || 'Order recorded.') : 'Order received and invoice reconciled.');
      nav.goBack();
    } catch (e: any) {
      showError(String(e?.message || e) || 'Could not complete receiving.');
    } finally {
      setSaving(false);
    }
  }, [venueId, orderId, scanResult, showSuccess, showError, nav]);

  // Reconcile preview card (shown in FlatList header when scan is available)
  const previewCard = useMemo(() => {
    if (!reconcilePreview?.ok) return null;
    const p = reconcilePreview;
    const c = p.counts || {};
    const t = p.totals || {};
    const anomalies: any[] = Array.isArray(p.anomalies) ? p.anomalies : [];
    const deltaKnown = Number.isFinite(t.invoiceTotal) && Number.isFinite(t.orderTotal);
    const delta = deltaKnown ? (t.invoiceTotal - t.orderTotal) : (t.delta ?? null);

    return (
      <View style={{
        backgroundColor: '#F0F9FF', borderRadius: 12, padding: 12,
        margin: 12, marginBottom: 4, borderWidth: 1, borderColor: '#BAE6FD'
      }}>
        <Text style={{ fontWeight: '800', color: '#0369A1', marginBottom: 4 }}>
          📋 Invoice Scanned {p.poMatch ? '· PO ✓' : '· PO ?'}
        </Text>

        <Text style={{ color: '#0369A1', fontSize: 12 }}>
          {`Matched: ${c.matched ?? 0} · Unknown: ${c.unknown ?? 0} · Qty diffs: ${c.qtyDiffs ?? 0} · Price diffs: ${c.priceChanges ?? 0} · Missing: ${c.missingOnInvoice ?? 0}`}
        </Text>

        {deltaKnown && (
          <Text style={{ color: '#0369A1', fontSize: 12, marginTop: 2 }}>
            {`Invoice: $${Number(t.invoiceTotal).toFixed(2)} · Order: $${Number(t.orderTotal).toFixed(2)} · Δ ${delta >= 0 ? '+' : ''}$${Number(delta).toFixed(2)}`}
          </Text>
        )}

        {anomalies.length > 0 && (
          <View style={{ marginTop: 8 }}>
            <Text style={{ fontWeight: '700', color: '#0369A1', fontSize: 12, marginBottom: 2 }}>
              Anomalies — review, then adjust quantities if needed:
            </Text>
            {anomalies.map((a, i) => (
              <Text key={i} style={{ color: '#0369A1', fontSize: 12, marginTop: 1 }}>
                {'• '}{formatAnomaly(a)}
              </Text>
            ))}
          </View>
        )}

        <Text style={{ color: '#64748B', fontSize: 11, marginTop: 8, fontStyle: 'italic' }}>
          Adjust received quantities above if needed, then tap Complete Receiving.
        </Text>
      </View>
    );
  }, [reconcilePreview]);

  if (!venueId || !orderId) {
    return <Centered><Text>Missing venue/order id.</Text></Centered>;
  }

  if (loading) {
    return (
      <Centered>
        <ActivityIndicator />
        <Text style={{ marginTop: 8 }}>Loading…</Text>
      </Centered>
    );
  }

  const isBusy = saving || scanning;

  return (
    <View style={{ flex: 1 }}>
      {/* Header area */}
      <View style={{ padding: 12, borderBottomWidth: 1, borderColor: '#eee', backgroundColor: '#fff' }}>
        <Text style={{ fontWeight: '800' }}>{supplierName}</Text>
        <Text style={{ color: '#6b7280', marginTop: 2 }}>
          {status ? status[0].toUpperCase() + status.slice(1) : '—'} • Ordered {totals.ordered} • Received {totals.received}
        </Text>

        {/* Actions row */}
        <View style={{ marginTop: 8, flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Button
            onPress={scanInvoice}
            disabled={isBusy}
            text={scanning ? 'Scanning…' : scanResult ? '📋 Rescan' : '📷 Scan Invoice'}
          />
          <Button onPress={receiveAll} disabled={isBusy} text="Receive All" />
          <Button onPress={() => persist(false)} disabled={isBusy} text={saving ? 'Saving…' : 'Save'} />
          <Button
            onPress={scanResult ? completeScanReceiving : () => persist(true)}
            disabled={isBusy}
            text={saving ? 'Working…' : 'Complete Receiving'}
            primary
          />
        </View>
      </View>

      {/* Lines — preview card shown as list header */}
      <FlatList
        keyboardShouldPersistTaps="handled"
        data={lines}
        keyExtractor={(l) => l.productId}
        contentContainerStyle={{ padding: 12 }}
        ListHeaderComponent={previewCard}
        renderItem={({ item }) => {
          const ordered = Number(item.qty || 0);
          const received = Number(item.receivedQty || 0);
          return (
            <View style={{
              backgroundColor: '#fff', borderRadius: 12, padding: 12, marginBottom: 10,
              borderWidth: 1, borderColor: '#eee'
            }}>
              <Text style={{ fontWeight: '700' }}>{item.name || item.productId}</Text>
              <Text style={{ color: '#6b7280', marginTop: 2 }}>Ordered: {ordered}</Text>

              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
                <TouchableOpacity onPress={() => bump(item.productId, -1)} style={pill(false)}>
                  <Text>−</Text>
                </TouchableOpacity>
                <Text style={{ marginHorizontal: 14, fontWeight: '700' }}>{received}</Text>
                <TouchableOpacity onPress={() => bump(item.productId, +1)} style={pill(false)}>
                  <Text>＋</Text>
                </TouchableOpacity>

                <View style={{ flex: 1 }} />
                <TouchableOpacity
                  onPress={() => setLines(prev => prev.map(l => l.productId === item.productId ? { ...l, receivedQty: ordered } : l))}
                  style={pill(true)}
                >
                  <Text style={{ color: '#fff' }}>All</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        }}
      />
    </View>
  );
}

function Centered({ children }: any) {
  return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>{children}</View>;
}
function Button({ text, onPress, primary, disabled }: any) {
  return (
    <TouchableOpacity onPress={onPress} disabled={disabled}
      style={{
        paddingHorizontal: 12, paddingVertical: 10, borderRadius: 8,
        backgroundColor: primary ? (disabled ? '#9CA3AF' : '#111827') : '#F3F4F6'
      }}>
      <Text style={{ color: primary ? '#fff' : '#111827', fontWeight: '700' }}>{text}</Text>
    </TouchableOpacity>
  );
}
function pill(primary: boolean) {
  return {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999,
    backgroundColor: primary ? '#111827' : '#F3F4F6'
  };
}
