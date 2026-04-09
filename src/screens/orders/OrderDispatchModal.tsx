// @ts-nocheck
/**
 * OrderDispatchModal
 * Shows after order is submitted — guides user through placing it
 * with their supplier via email, portal, print/share, or phone.
 * All paths record dispatchMethod + confirm "placed" in Firestore.
 */
import React, { useCallback, useState } from 'react';
import { getFirestore, updateDoc, doc, serverTimestamp } from 'firebase/firestore';
import {
  ActivityIndicator, Alert, Linking, Modal,
  ScrollView, Text, TouchableOpacity, View,
} from 'react-native';

type OrderLine = { name: string; qty: number; unit?: string; unitCost?: number };

type Props = {
  visible: boolean;
  onClose: () => void;
  onPlaced: () => void;
  orderId: string;
  venueId: string;
  poNumber: string;
  supplierName: string;
  supplierEmail?: string | null;
  supplierPortalUrl?: string | null;
  orderingMethod?: 'email' | 'portal' | 'phone';
  lines: OrderLine[];
  totalCost?: number;
};

function formatOrderBody(po: string, supplier: string, lines: OrderLine[], total?: number): string {
  const lineItems = lines
    .filter(l => l.qty > 0)
    .map(l => {
      const cost = l.unitCost ? ` @ $${l.unitCost.toFixed(2)} = $${(l.qty * l.unitCost).toFixed(2)}` : '';
      return `  • ${l.name}: ${l.qty} ${l.unit || 'units'}${cost}`;
    })
    .join('\n');
  const totalLine = total ? `\nOrder Total: $${total.toFixed(2)}` : '';
  return `Purchase Order: ${po}
Supplier: ${supplier}
Date: ${new Date().toLocaleDateString('en-NZ')}

Order Items:
${lineItems}
${totalLine}

Please confirm receipt of this order.
Sent via Hosti-Stock.`;
}

export default function OrderDispatchModal({
  visible, onClose, onPlaced,
  orderId, venueId, poNumber,
  supplierName, supplierEmail, supplierPortalUrl,
  orderingMethod = 'email', lines, totalCost,
}: Props) {
  const [busy, setBusy] = useState(false);
  const db = getFirestore();

  const markPlaced = useCallback(async (method: string) => {
    try {
      await updateDoc(doc(db, 'venues', venueId, 'orders', orderId), {
        status: 'placed',
        dispatchMethod: method,
        placedAt: serverTimestamp(),
      });
    } catch (e) {
      console.log('[OrderDispatch] markPlaced error', e);
    }
  }, [db, venueId, orderId]);

  const onEmail = useCallback(async () => {
    if (!supplierEmail) {
      Alert.alert('No email', 'Add a supplier email address in Supplier settings first.');
      return;
    }
    setBusy(true);
    const subject = encodeURIComponent(`Purchase Order ${poNumber} — ${supplierName}`);
    const body = encodeURIComponent(formatOrderBody(poNumber, supplierName, lines, totalCost));
    const mailto = `mailto:${supplierEmail}?subject=${subject}&body=${body}`;
    try {
      await Linking.openURL(mailto);
      // Give email app time to open then confirm
      setTimeout(() => {
        Alert.alert(
          'Order sent?',
          'Once you have sent the email, tap confirm to mark this order as placed.',
          [
            { text: 'Confirm — order placed', onPress: async () => { await markPlaced('email'); onPlaced(); } },
            { text: 'Not yet', style: 'cancel' },
          ]
        );
        setBusy(false);
      }, 1500);
    } catch {
      Alert.alert('Could not open email', 'Please send the order manually.');
      setBusy(false);
    }
  }, [supplierEmail, poNumber, supplierName, lines, totalCost, markPlaced, onPlaced]);

  const onPortal = useCallback(async () => {
    const url = supplierPortalUrl || null;
    if (!url) {
      Alert.alert('No portal URL', 'Add the supplier portal URL in Supplier settings first.');
      return;
    }
    setBusy(true);
    try {
      await Linking.openURL(url);
      setTimeout(() => {
        Alert.alert(
          'Order placed on portal?',
          'Once you have placed the order on the supplier portal, tap confirm.',
          [
            { text: 'Confirm — order placed', onPress: async () => { await markPlaced('portal'); onPlaced(); } },
            { text: 'Not yet', style: 'cancel' },
          ]
        );
        setBusy(false);
      }, 1500);
    } catch {
      Alert.alert('Could not open portal', 'Please visit the portal manually.');
      setBusy(false);
    }
  }, [supplierPortalUrl, markPlaced, onPlaced]);

  const onShare = useCallback(async () => {
    setBusy(true);
    const text = formatOrderBody(poNumber, supplierName, lines, totalCost);
    try {
      const { Share } = require('react-native');
      await Share.share({
        message: text,
        title: `PO ${poNumber} — ${supplierName}`,
      });
      Alert.alert(
        'Order shared?',
        'Once you have placed the order, tap confirm to record it.',
        [
          { text: 'Confirm — order placed', onPress: async () => { await markPlaced('print'); onPlaced(); } },
          { text: 'Not yet', style: 'cancel' },
        ]
      );
    } catch {}
    setBusy(false);
  }, [poNumber, supplierName, lines, totalCost, markPlaced, onPlaced]);

  const onPhone = useCallback(() => {
    const text = formatOrderBody(poNumber, supplierName, lines, totalCost);
    Alert.alert(
      'Call your order in',
      'Here is your order summary. Read it to your supplier then confirm below.\n\n' + text,
      [
        { text: 'Confirm — order placed', onPress: async () => { await markPlaced('phone'); onPlaced(); } },
        { text: 'Not yet', style: 'cancel' },
      ]
    );
  }, [poNumber, supplierName, lines, totalCost, markPlaced, onPlaced]);

  const activeLines = lines.filter(l => l.qty > 0);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
        <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '90%' }}>
          <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
            {/* Header */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontSize: 20, fontWeight: '900' }}>Place Order</Text>
              <TouchableOpacity onPress={onClose} style={{ padding: 4 }}>
                <Text style={{ fontSize: 20, color: '#9CA3AF' }}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Order summary */}
            <View style={{ backgroundColor: '#F9FAFB', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#E5E7EB' }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontWeight: '800', color: '#111' }}>{supplierName}</Text>
                <Text style={{ fontWeight: '700', color: '#6B7280' }}>PO: {poNumber}</Text>
              </View>
              <Text style={{ color: '#6B7280', fontSize: 13, marginTop: 4 }}>
                {activeLines.length} items{totalCost ? ` · $${totalCost.toFixed(2)} total` : ''}
              </Text>
              {activeLines.slice(0, 4).map((l, i) => (
                <Text key={i} style={{ color: '#374151', fontSize: 12, marginTop: 2 }}>
                  • {l.name}: {l.qty} {l.unit || 'units'}
                </Text>
              ))}
              {activeLines.length > 4 && (
                <Text style={{ color: '#9CA3AF', fontSize: 12, marginTop: 2 }}>+ {activeLines.length - 4} more items</Text>
              )}
            </View>

            <Text style={{ fontWeight: '800', color: '#374151' }}>How would you like to place this order?</Text>

            {/* Email option */}
            <TouchableOpacity
              onPress={onEmail}
              disabled={busy}
              style={{ backgroundColor: supplierEmail ? '#EFF6FF' : '#F9FAFB', borderRadius: 14, padding: 16, borderWidth: 1, borderColor: supplierEmail ? '#BFDBFE' : '#E5E7EB' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Text style={{ fontSize: 24 }}>📧</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '900', color: supplierEmail ? '#1D4ED8' : '#9CA3AF' }}>Send email order</Text>
                  <Text style={{ fontSize: 12, color: supplierEmail ? '#3B82F6' : '#9CA3AF', marginTop: 2 }}>
                    {supplierEmail ? `To: ${supplierEmail}` : 'No email set — add in Supplier settings'}
                  </Text>
                </View>
                {busy && <ActivityIndicator size="small" color="#1D4ED8" />}
              </View>
            </TouchableOpacity>

            {/* Portal option */}
            <TouchableOpacity
              onPress={onPortal}
              disabled={busy}
              style={{ backgroundColor: supplierPortalUrl ? '#F0FDF4' : '#F9FAFB', borderRadius: 14, padding: 16, borderWidth: 1, borderColor: supplierPortalUrl ? '#BBF7D0' : '#E5E7EB' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Text style={{ fontSize: 24 }}>🌐</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '900', color: supplierPortalUrl ? '#166534' : '#9CA3AF' }}>Open supplier portal</Text>
                  <Text style={{ fontSize: 12, color: supplierPortalUrl ? '#16A34A' : '#9CA3AF', marginTop: 2 }}>
                    {supplierPortalUrl ? supplierPortalUrl : 'No portal URL set — add in Supplier settings'}
                  </Text>
                </View>
              </View>
            </TouchableOpacity>

            {/* Share/Print option */}
            <TouchableOpacity
              onPress={onShare}
              disabled={busy}
              style={{ backgroundColor: '#FEF3C7', borderRadius: 14, padding: 16, borderWidth: 1, borderColor: '#FDE68A' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Text style={{ fontSize: 24 }}>📋</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '900', color: '#92400E' }}>Share / Print order</Text>
                  <Text style={{ fontSize: 12, color: '#B45309', marginTop: 2 }}>Copy, share or print the order — place it manually</Text>
                </View>
              </View>
            </TouchableOpacity>

            {/* Phone option */}
            <TouchableOpacity
              onPress={onPhone}
              disabled={busy}
              style={{ backgroundColor: '#F5F3FF', borderRadius: 14, padding: 16, borderWidth: 1, borderColor: '#DDD6FE' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Text style={{ fontSize: 24 }}>📞</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '900', color: '#5B21B6' }}>Call it in</Text>
                  <Text style={{ fontSize: 12, color: '#7C3AED', marginTop: 2 }}>Show order details to read to your supplier</Text>
                </View>
              </View>
            </TouchableOpacity>

            {/* Honest note */}
            <View style={{ backgroundColor: '#F9FAFB', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#E5E7EB' }}>
              <Text style={{ color: '#6B7280', fontSize: 12 }}>
                All methods record this order in Hosti-Stock. When your invoice arrives, match it to PO {poNumber} for automatic reconciliation.
              </Text>
            </View>

            <View style={{ height: 20 }} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
