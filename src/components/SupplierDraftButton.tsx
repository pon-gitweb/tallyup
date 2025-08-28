import React, { useState } from 'react';
import { TouchableOpacity, Text, ActivityIndicator, View, Alert } from 'react-native';
import { db } from '../services/firebase';
import { createDraftForSupplier, DraftLine } from '../services/orderDrafts';

type Props = {
  venueId: string;
  supplierId: string;
  supplierName: string;
  lines: DraftLine[];
  deliveryDate?: Date | null;
  onDrafted?: (orderId: string) => void;
};

export default function SupplierDraftButton({
  venueId, supplierId, supplierName, lines, deliveryDate, onDrafted,
}: Props) {
  const [busy, setBusy] = useState(false);

  const onPress = async () => {
    if (!venueId || !supplierId || lines.length === 0) {
      Alert.alert('Nothing to draft', 'No items selected for this supplier.');
      return;
    }
    try {
      setBusy(true);
      const orderId = await createDraftForSupplier(
        db,
        venueId,
        supplierId,
        supplierName,
        deliveryDate ?? null,
        lines
      );
      setBusy(false);
      if (onDrafted) onDrafted(orderId);
      else Alert.alert('Draft created', `Supplier: ${supplierName}\nOrder: ${orderId}`);
    } catch (e: any) {
      setBusy(false);
      Alert.alert('Failed to create draft', e?.message ?? 'Unknown error');
    }
  };

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={busy}
      style={{
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 8,
        backgroundColor: busy ? '#E0E0E0' : '#222',
        alignSelf: 'flex-start',
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {busy ? <ActivityIndicator /> : null}
        <Text style={{ color: 'white', fontWeight: '700' }}>
          {busy ? 'Drafting…' : 'Draft this'}
        </Text>
      </View>
    </TouchableOpacity>
  );
}
