// @ts-nocheck
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Alert, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useNavigation } from '@react-navigation/native';
import { getAuth } from 'firebase/auth';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { useVenueId, useVenueType } from '../../context/VenueProvider';
import { useColours } from '../../context/ThemeContext';
import { useToast } from '../common/Toast';
import { useConfirmModal } from '../common/useConfirmModal';
import { runPhotoOcrJob } from '../../services/ocr/photoOcr';
import { apiBase } from '../../services/apiBase';
import { db } from '../../services/firebase';

type Props = {
  // Caller will receive normalized lines to pipe into your existing mapping UI
  onParsed: (payload: {
    supplierName?: string;
    invoiceNumber?: string;
    deliveryDate?: string;
    lines: Array<{ name: string; qty: number; unit?: string; unitPrice?: number }>;
    raw?: any;
  }) => void;
};

const DOC_TYPE_OPTIONS: Array<{ key: string; label: string }> = [
  { key: 'auto', label: 'Auto-detect' },
  { key: 'TAX_INVOICE', label: 'Tax invoice' },
  { key: 'PACKING_SLIP', label: 'Packing slip' },
  { key: 'DELIVERY_NOTE', label: 'Delivery note' },
  { key: 'CREDIT_NOTE', label: 'Credit note' },
];

export default function PhotoOCRPanel({ onParsed }: Props) {
  const venueId = useVenueId();
  const venueType = useVenueType();
  const navigation = useNavigation<any>();
  const colours = useColours();
  const { showSuccess, showError } = useToast();
  const { confirm, modal } = useConfirmModal();
  const [busy, setBusy] = useState(false);
  const [docTypeHint, setDocTypeHint] = useState('auto');
  const [lastLocalUri, setLastLocalUri] = useState<string | null>(null);
  const [addingAllStubs, setAddingAllStubs] = useState(false);

  // Support request state — shown after invoice scan detects repeated price failures
  const [pendingSupportRequest, setPendingSupportRequest] = useState<{
    supplierName: string;
    invoiceDocId: string | null;
    storageRef: string | null;
  } | null>(null);
  const [sendingToSupport, setSendingToSupport] = useState(false);

  // Result screens shown after a scan completes
  const [lateInvoice, setLateInvoice] = useState<any | null>(null);
  const [matchConfirm, setMatchConfirm] = useState<any | null>(null);
  const [packingSlipResult, setPackingSlipResult] = useState<any | null>(null);
  const [deliveryNoteResult, setDeliveryNoteResult] = useState<any | null>(null);
  const [creditNoteResult, setCreditNoteResult] = useState<any | null>(null);
  const [manualSelect, setManualSelect] = useState<any | null>(null);

  function resetResultScreens() {
    setLateInvoice(null);
    setMatchConfirm(null);
    setPackingSlipResult(null);
    setDeliveryNoteResult(null);
    setCreditNoteResult(null);
    setManualSelect(null);
  }

  function handleParsed(parsed: any) {
    const documentType = parsed?.documentType || 'TAX_INVOICE';

    if (documentType === 'TAX_INVOICE' && parsed?.isLateInvoice) {
      setLateInvoice(parsed);
      return;
    }

    if (documentType === 'TAX_INVOICE' && parsed?.matched && parsed?.matchConfidence === 'medium') {
      setMatchConfirm(parsed);
      return;
    }

    if (documentType === 'PACKING_SLIP') {
      setPackingSlipResult(parsed);
      return;
    }

    if (documentType === 'DELIVERY_NOTE') {
      setDeliveryNoteResult(parsed);
      return;
    }

    if (documentType === 'CREDIT_NOTE') {
      setCreditNoteResult(parsed);
      return;
    }

    if (parsed?.manualSelectionRequired) {
      setManualSelect(parsed);
      return;
    }

    // Standard TAX_INVOICE flow (unchanged)
    onParsed(parsed);
    if (parsed?.hasPriceChanges) {
      navigation.navigate('InvoiceSummary', {
        supplierName: parsed.supplierName || null,
        invoiceNumber: parsed.invoiceNumber || null,
        productCount: parsed.lines?.length || 0,
        priceChanges: parsed.priceChanges || [],
        supplierId: parsed.supplierId || null,
        invoiceDocId: parsed.invoiceDocId || null,
        venueType,
      });
    }
    if (parsed?.requestInvoiceCopy && parsed?.failureSupplier) {
      setPendingSupportRequest({
        supplierName: parsed.failureSupplier,
        invoiceDocId: parsed.invoiceDocId || null,
        storageRef: parsed.documentStorageRef || null,
      });
    }
  }

  async function sendInvoiceToSupport() {
    if (!venueId || !pendingSupportRequest) return;
    try {
      setSendingToSupport(true);
      const auth = getAuth();
      const idToken = await auth.currentUser?.getIdToken();
      const resp = await fetch(`${apiBase()}/send-failing-invoice`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          venueId,
          supplierName: pendingSupportRequest.supplierName,
          documentStorageRef: pendingSupportRequest.storageRef,
          invoiceDocId: pendingSupportRequest.invoiceDocId,
        }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err?.error || `HTTP ${resp.status}`);
      }
      setPendingSupportRequest(null);
      Alert.alert('Sent', 'Thanks for helping us improve extraction for this supplier.');
    } catch (e: any) {
      Alert.alert('Could not send', e?.message || 'Please try again.');
    } finally {
      setSendingToSupport(false);
    }
  }

  async function takePhoto() {
    try {
      console.log('[PhotoOCRPanel] takePhoto tapped', { venueId, docTypeHint });

      if (!venueId) {
        Alert.alert('No Venue', 'Attach a venue first.');
        console.log('[PhotoOCRPanel] abort: no venueId');
        return;
      }

      const cameraPerm = await ImagePicker.requestCameraPermissionsAsync();
      console.log('[PhotoOCRPanel] camera permission result', cameraPerm);

      if (cameraPerm.status !== 'granted') {
        Alert.alert('Camera permission', 'Camera access is required.');
        return;
      }

      const res = await ImagePicker.launchCameraAsync({
        allowsEditing: false,
        quality: Platform.OS === 'ios' ? 0.7 : 0.5,
      });

      console.log('[PhotoOCRPanel] launchCameraAsync result', {
        canceled: res.canceled,
        assetCount: res.assets?.length ?? 0,
      });

      if (res.canceled || !res.assets?.length) return;

      resetResultScreens();
      setBusy(true);
      const asset = res.assets[0];
      setLastLocalUri(asset.uri);

      console.log('[PhotoOCRPanel] calling runPhotoOcrJob', {
        venueId,
        uri: asset.uri,
        docTypeHint,
      });

      const parsed = await runPhotoOcrJob({
        venueId,
        localUri: asset.uri,
        docTypeHint: docTypeHint !== 'auto' ? docTypeHint : undefined,
      });

      console.log('[PhotoOCRPanel] runPhotoOcrJob result summary', {
        documentType: parsed?.documentType,
        supplierName: parsed?.supplierName || null,
        invoiceNumber: parsed?.invoiceNumber || null,
        deliveryDate: parsed?.deliveryDate || null,
        lineCount: parsed?.lines?.length ?? 0,
      });

      setBusy(false);
      handleParsed(parsed);
    } catch (e: any) {
      setBusy(false);
      console.log('[PhotoOCRPanel] error during scan', e);
      Alert.alert('OCR failed', e?.message || 'Unknown error');
    }
  }

  async function handleLateInvoiceDecision(decision: 'apply_current' | 'hold_for_review') {
    if (!venueId || !lateInvoice) return;
    try {
      setBusy(true);
      const parsed = await runPhotoOcrJob({
        venueId,
        lateInvoiceDecision: decision,
        cachedInvoiceData: lateInvoice.invoiceData,
      });
      setBusy(false);
      setLateInvoice(null);
      handleParsed(parsed);
    } catch (e: any) {
      setBusy(false);
      Alert.alert('Could not process invoice', e?.message || 'Unknown error');
    }
  }

  async function handleConfirmDeliveryMatch(confirm: boolean) {
    if (!venueId || !matchConfirm) return;
    if (!confirm) {
      // User says it's not a match — just complete the normal invoice flow
      const parsed = matchConfirm;
      setMatchConfirm(null);
      onParsed(parsed);
      if (parsed?.hasPriceChanges) {
        navigation.navigate('InvoiceSummary', {
          supplierName: parsed.supplierName || null,
          invoiceNumber: parsed.invoiceNumber || null,
          productCount: parsed.lines?.length || 0,
          priceChanges: parsed.priceChanges || [],
          supplierId: parsed.supplierId || null,
          invoiceDocId: parsed.invoiceDocId || null,
          venueType,
        });
      }
      return;
    }
    try {
      setBusy(true);
      await runPhotoOcrJob({
        venueId,
        confirmDeliveryMatch: true,
        deliveryId: matchConfirm.deliveryId,
        invoiceDocId: matchConfirm.invoiceDocId,
      });
      setBusy(false);
      const parsed = matchConfirm;
      setMatchConfirm(null);
      onParsed(parsed);
      if (parsed?.hasPriceChanges) {
        navigation.navigate('InvoiceSummary', {
          supplierName: parsed.supplierName || null,
          invoiceNumber: parsed.invoiceNumber || null,
          productCount: parsed.lines?.length || 0,
          priceChanges: parsed.priceChanges || [],
          supplierId: parsed.supplierId || null,
          invoiceDocId: parsed.invoiceDocId || null,
          venueType,
        });
      }
    } catch (e: any) {
      setBusy(false);
      Alert.alert('Could not confirm match', e?.message || 'Unknown error');
    }
  }

  async function rescanAs(type: string) {
    if (!venueId || !lastLocalUri) {
      Alert.alert('Please take a new photo', 'Select a document type below and tap "Take photo".');
      setDocTypeHint(type);
      resetResultScreens();
      return;
    }
    try {
      resetResultScreens();
      setBusy(true);
      const parsed = await runPhotoOcrJob({
        venueId,
        localUri: lastLocalUri,
        docTypeHint: type,
      });
      setBusy(false);
      handleParsed(parsed);
    } catch (e: any) {
      setBusy(false);
      Alert.alert('OCR failed', e?.message || 'Unknown error');
    }
  }

  // ── Unmatched packing-slip lines — add to products ──────────────────────

  function addUnmatchedLineToProducts(line: any) {
    navigation.navigate('EditProductScreen', {
      productId: null,
      product: {
        name: line.name || line.productName || '',
        supplierName: packingSlipResult?.supplierName || null,
        supplierId: packingSlipResult?.supplierId || null,
        costPrice: line.unitCost > 0 ? line.unitCost : (line.unitPrice > 0 ? line.unitPrice : null),
        unit: line.unit || null,
      },
    });
  }

  function addAllUnmatchedAsStubs() {
    const lines = packingSlipResult?.unmatchedLines || [];
    if (!venueId || !lines.length) return;
    confirm({
      title: 'Add all as products?',
      message: `This adds ${lines.length} product${lines.length > 1 ? 's' : ''} with just a name and supplier. You can fill in unit, pack size and GST later in Products.`,
      confirmLabel: 'Add all',
      cancelLabel: 'Cancel',
      onConfirm: async () => {
        setAddingAllStubs(true);
        try {
          for (const line of lines) {
            await addDoc(collection(db, 'venues', venueId, 'products'), {
              name: line.name || line.productName || '',
              supplierName: packingSlipResult?.supplierName || 'Unassigned',
              supplierId: packingSlipResult?.supplierId || null,
              costPrice: line.unitCost > 0 ? line.unitCost : null,
              unit: line.unit || null,
              packSize: null,
              gstPercent: null,
              inductionSource: 'invoice-scan',
              inductionStatus: 'pending',
              createdAt: serverTimestamp(),
            });
          }
          setPackingSlipResult((prev: any) => (prev ? { ...prev, unmatchedLines: [] } : prev));
          showSuccess(`${lines.length} product${lines.length > 1 ? 's' : ''} added — tap Products to complete their details.`);
        } catch (e: any) {
          showError(e?.message || 'Could not add products.');
        } finally {
          setAddingAllStubs(false);
        }
      },
    });
  }

  // ── Result screens ──────────────────────────────────────────────────────

  if (lateInvoice) {
    return (
      <View style={panelStyle}>
        <Text style={{ fontWeight: '700', fontSize: 16 }}>⏱️ Late invoice detected</Text>
        <Text style={{ opacity: 0.8, lineHeight: 19 }}>
          This invoice is dated {lateInvoice.invoiceDate || 'within'} a stocktake period that ended {lateInvoice.cycleEndDate}.
          {' '}How should this be handled?
        </Text>
        <TouchableOpacity
          onPress={() => handleLateInvoiceDecision('apply_current')}
          style={{ backgroundColor: '#0A84FF', paddingVertical: 12, borderRadius: 10, alignItems: 'center' }}
          disabled={busy}
        >
          {busy ? <ActivityIndicator color="white" /> : <Text style={{ color: 'white', fontWeight: '700' }}>Apply to current cycle (recommended)</Text>}
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => handleLateInvoiceDecision('hold_for_review')}
          style={{ backgroundColor: '#E5E7EB', paddingVertical: 12, borderRadius: 10, alignItems: 'center' }}
          disabled={busy}
        >
          <Text style={{ color: '#111', fontWeight: '700' }}>Hold for manager review</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (matchConfirm) {
    const summary = matchConfirm.deliverySummary || {};
    return (
      <View style={panelStyle}>
        <Text style={{ fontWeight: '700', fontSize: 16 }}>🔗 Possible delivery match</Text>
        <Text style={{ opacity: 0.8, lineHeight: 19 }}>
          This invoice may match a delivery already received:
        </Text>
        <View style={{ backgroundColor: '#F2F2F7', borderRadius: 10, padding: 10, gap: 4 }}>
          <Text style={{ fontWeight: '600' }}>{summary.supplierName || 'Unknown supplier'}</Text>
          {summary.deliveryDate ? <Text style={{ opacity: 0.7 }}>Delivered {summary.deliveryDate}</Text> : null}
          {summary.lineCount ? <Text style={{ opacity: 0.7 }}>{summary.lineCount} line item(s)</Text> : null}
          {summary.packingSlipRef ? <Text style={{ opacity: 0.7 }}>Packing slip ref: {summary.packingSlipRef}</Text> : null}
        </View>
        <TouchableOpacity
          onPress={() => handleConfirmDeliveryMatch(true)}
          style={{ backgroundColor: '#0A84FF', paddingVertical: 12, borderRadius: 10, alignItems: 'center' }}
          disabled={busy}
        >
          {busy ? <ActivityIndicator color="white" /> : <Text style={{ color: 'white', fontWeight: '700' }}>Yes, confirm match</Text>}
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => handleConfirmDeliveryMatch(false)}
          style={{ backgroundColor: '#E5E7EB', paddingVertical: 12, borderRadius: 10, alignItems: 'center' }}
          disabled={busy}
        >
          <Text style={{ color: '#111', fontWeight: '700' }}>No, not a match</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (packingSlipResult) {
    const unmatchedLines = packingSlipResult.unmatchedLines || [];
    return (
      <View style={panelStyle}>
        {modal}
        <Text style={{ fontWeight: '700', fontSize: 16 }}>📦 Packing slip scanned</Text>
        <Text style={{ opacity: 0.8, lineHeight: 19 }}>{packingSlipResult.message}</Text>
        <View style={{ backgroundColor: '#F2F2F7', borderRadius: 10, padding: 10, gap: 4 }}>
          <Text>Supplier: {packingSlipResult.supplierName || 'Unknown'}</Text>
          <Text>Lines processed: {packingSlipResult.linesProcessed ?? 0}</Text>
          {packingSlipResult.provisionalCost != null && (
            <Text>Provisional cost: ${Number(packingSlipResult.provisionalCost).toFixed(2)}</Text>
          )}
        </View>

        {unmatchedLines.length > 0 && (
          <View style={{ backgroundColor: colours.cream, borderRadius: 10, padding: 10, borderWidth: 1, borderColor: colours.border, gap: 8 }}>
            <Text style={{ fontWeight: '700', color: colours.text }}>
              {unmatchedLines.length} line{unmatchedLines.length > 1 ? 's' : ''} couldn't be matched to a product
            </Text>

            <TouchableOpacity
              onPress={addAllUnmatchedAsStubs}
              disabled={addingAllStubs}
              style={{ backgroundColor: colours.deepBlue, borderRadius: 8, paddingVertical: 10, alignItems: 'center' }}
            >
              {addingAllStubs
                ? <ActivityIndicator color={colours.primaryText} size="small" />
                : <Text style={{ color: colours.primaryText, fontWeight: '700', fontSize: 13 }}>Add all {unmatchedLines.length} as products</Text>}
            </TouchableOpacity>

            {unmatchedLines.map((line: any, i: number) => {
              const price = line.unitCost > 0 ? line.unitCost : (line.unitPrice > 0 ? line.unitPrice : null);
              return (
                <View key={i} style={{ backgroundColor: colours.surface, borderRadius: 8, padding: 10, borderWidth: 1, borderColor: colours.border, gap: 4 }}>
                  <Text style={{ fontWeight: '700', color: colours.text }}>{line.name || line.productName}</Text>
                  <Text style={{ fontSize: 12, color: colours.textSecondary }}>
                    Qty {line.qty}{line.unit ? ` ${line.unit}` : ''}
                    {price != null ? ` · $${Number(price).toFixed(2)}` : ''}
                  </Text>
                  <TouchableOpacity
                    onPress={() => addUnmatchedLineToProducts(line)}
                    style={{ backgroundColor: colours.deepBlue, borderRadius: 8, paddingVertical: 8, alignItems: 'center', marginTop: 2 }}
                  >
                    <Text style={{ color: colours.primaryText, fontWeight: '700', fontSize: 13 }}>Add to products</Text>
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>
        )}

        <TouchableOpacity
          onPress={resetResultScreens}
          style={{ backgroundColor: '#0A84FF', paddingVertical: 12, borderRadius: 10, alignItems: 'center' }}
        >
          <Text style={{ color: 'white', fontWeight: '700' }}>Done</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (deliveryNoteResult) {
    const data = deliveryNoteResult.deliveryNoteData || {};
    return (
      <View style={panelStyle}>
        <Text style={{ fontWeight: '700', fontSize: 16 }}>🚚 Delivery note scanned</Text>
        <Text style={{ opacity: 0.8, lineHeight: 19 }}>{deliveryNoteResult.message}</Text>
        <View style={{ backgroundColor: '#F2F2F7', borderRadius: 10, padding: 10, gap: 4 }}>
          {data.courier ? <Text>Courier: {data.courier}</Text> : null}
          {data.senderName ? <Text>From: {data.senderName}</Text> : null}
          {data.trackingNumber ? <Text>Tracking: {data.trackingNumber}</Text> : null}
          {data.packageCount ? <Text>Packages: {data.packageCount}</Text> : null}
        </View>
        <TouchableOpacity
          onPress={() => navigation.navigate('Orders')}
          style={{ backgroundColor: '#0A84FF', paddingVertical: 12, borderRadius: 10, alignItems: 'center' }}
        >
          <Text style={{ color: 'white', fontWeight: '700' }}>Match to an order</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => { resetResultScreens(); setDocTypeHint('PACKING_SLIP'); }}
          style={{ backgroundColor: '#E5E7EB', paddingVertical: 12, borderRadius: 10, alignItems: 'center' }}
        >
          <Text style={{ color: '#111', fontWeight: '700' }}>Upload packing slip instead</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={resetResultScreens}
          style={{ paddingVertical: 10, alignItems: 'center' }}
        >
          <Text style={{ color: '#6b7280' }}>Enter received stock manually</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (creditNoteResult) {
    return (
      <View style={panelStyle}>
        <Text style={{ fontWeight: '700', fontSize: 16 }}>↩️ Credit note scanned</Text>
        <Text style={{ opacity: 0.8, lineHeight: 19 }}>{creditNoteResult.message}</Text>
        <View style={{ backgroundColor: '#F2F2F7', borderRadius: 10, padding: 10, gap: 4 }}>
          <Text>Supplier: {creditNoteResult.supplierName || 'Unknown'}</Text>
          <Text>Lines: {creditNoteResult.linesProcessed ?? 0}</Text>
          {creditNoteResult.totalAmount != null && (
            <Text>Total: ${Math.abs(Number(creditNoteResult.totalAmount)).toFixed(2)} credit</Text>
          )}
        </View>
        <TouchableOpacity
          onPress={resetResultScreens}
          style={{ backgroundColor: '#0A84FF', paddingVertical: 12, borderRadius: 10, alignItems: 'center' }}
        >
          <Text style={{ color: 'white', fontWeight: '700' }}>Done</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (manualSelect) {
    return (
      <View style={panelStyle}>
        <Text style={{ fontWeight: '700', fontSize: 16 }}>🤔 Couldn't identify this document</Text>
        <Text style={{ opacity: 0.8, lineHeight: 19 }}>{manualSelect.message}</Text>
        <Text style={{ fontWeight: '600', marginTop: 4 }}>What kind of document is this?</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {DOC_TYPE_OPTIONS.filter(o => o.key !== 'auto').map(o => (
            <TouchableOpacity
              key={o.key}
              onPress={() => rescanAs(o.key)}
              style={{ borderWidth: 1, borderColor: '#0A84FF', borderRadius: 999, paddingVertical: 8, paddingHorizontal: 14 }}
            >
              <Text style={{ color: '#0A84FF', fontWeight: '600' }}>{o.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    );
  }

  // ── Default scan panel ──────────────────────────────────────────────────

  return (
    <View style={panelStyle}>
      {pendingSupportRequest && (
        <View style={{ backgroundColor: '#FEF3C7', borderRadius: 10, padding: 12, gap: 8 }}>
          <Text style={{ fontWeight: '700', color: '#92400E' }}>Repeated price extraction issues</Text>
          <Text style={{ fontSize: 13, color: '#78350F', lineHeight: 18 }}>
            We've had trouble reading prices from {pendingSupportRequest.supplierName} invoices multiple times.
            Sending this invoice to Hosti support helps us improve extraction for this supplier.
          </Text>
          <TouchableOpacity
            onPress={sendInvoiceToSupport}
            disabled={sendingToSupport}
            style={{ backgroundColor: '#D97706', paddingVertical: 10, borderRadius: 8, alignItems: 'center' }}
          >
            {sendingToSupport
              ? <ActivityIndicator color="white" size="small" />
              : <Text style={{ color: 'white', fontWeight: '700' }}>Send invoice to Hosti support</Text>}
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setPendingSupportRequest(null)}
            style={{ paddingVertical: 6, alignItems: 'center' }}
          >
            <Text style={{ color: '#78350F' }}>Not now</Text>
          </TouchableOpacity>
        </View>
      )}
      <Text style={{ fontWeight: '700' }}>Scan document (Photo OCR)</Text>
      <Text style={{ opacity: 0.7 }}>
        Take a photo of an invoice, packing slip, delivery note, or credit note. We'll detect the type automatically.
      </Text>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {DOC_TYPE_OPTIONS.map(o => {
          const active = docTypeHint === o.key;
          return (
            <TouchableOpacity
              key={o.key}
              onPress={() => setDocTypeHint(o.key)}
              style={{
                borderWidth: 1,
                borderColor: active ? '#0A84FF' : '#D0D3D7',
                backgroundColor: active ? '#0A84FF' : 'transparent',
                borderRadius: 999,
                paddingVertical: 6,
                paddingHorizontal: 12,
              }}
            >
              <Text style={{ color: active ? 'white' : '#3C3C43', fontWeight: '600', fontSize: 12 }}>{o.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {busy ? (
        <View style={{ alignItems: 'center', gap: 6 }}>
          <ActivityIndicator />
          <Text>Running OCR…</Text>
        </View>
      ) : (
        <TouchableOpacity
          onPress={takePhoto}
          style={{
            backgroundColor: '#0A84FF',
            paddingVertical: 12,
            borderRadius: 10,
            alignItems: 'center',
          }}
        >
          <Text style={{ color: 'white', fontWeight: '700' }}>Take photo</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const panelStyle = {
  padding: 12,
  borderWidth: 1,
  borderColor: '#E5E7EB',
  borderRadius: 12,
  backgroundColor: 'white',
  gap: 8,
} as const;
