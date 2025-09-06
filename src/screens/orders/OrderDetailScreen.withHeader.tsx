import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, Alert } from 'react-native';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import OriginalOrderDetailScreen from './OrderDetailScreen';

import { getApp } from 'firebase/app';
import { getFirestore, doc, onSnapshot } from 'firebase/firestore';
import { useVenue } from '../../context/VenueProvider';
import { submitDraftOrder } from '../../services/orders';

export default function OrderDetailWithHeader(props: any) {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { venueId, user } = useVenue() as any;

  const p = (route?.params as any) || {};
  const orderId: string | undefined = p?.orderId || p?.id || p?.order?.id;
  const paramStatus: string | undefined = p?.status || p?.order?.status;

  const [liveStatus, setLiveStatus] = useState<string | undefined>(undefined);

  // Live order status
  useEffect(() => {
    if (!venueId || !orderId) return;
    const db = getFirestore(getApp());
    const ref = doc(db, 'venues', venueId, 'orders', orderId);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        const data = snap.data() as any;
        if (data && typeof data.status === 'string') setLiveStatus(data.status);
      },
      (err) => console.warn('[OrderDetailHeader] onSnapshot error', err)
    );
    return () => unsub();
  }, [venueId, orderId]);

  const status = useMemo(() => (liveStatus ?? paramStatus ?? '').toString().toLowerCase() || undefined, [liveStatus, paramStatus]);

  // Visibility rules (MVP)
  const showSubmit  = status === 'draft';
  const showReceive = status === 'submitted';
  const showInvoice = status === 'submitted' || status === 'received';

  const doSubmit = useCallback(async () => {
    try {
      if (!venueId || !orderId) throw new Error('Missing venue/order id.');
      await submitDraftOrder(venueId, orderId, user?.uid);
      setLiveStatus('submitted'); // optimistic; snapshot will confirm
      Alert.alert('Order', 'Order submitted.');
    } catch (e: any) {
      console.warn('[OrderDetailHeader] submit error', e);
      Alert.alert('Order', e?.message || 'Failed to submit order.');
    }
  }, [venueId, orderId, user?.uid]);

  const applyHeader = useCallback(() => {
    console.log('[OrderDetailHeader v5] apply', { orderId, status, showSubmit, showReceive, showInvoice });
    navigation.setOptions({
      headerRight: () => (
        <View style={{ flexDirection: 'row' }}>
          {showSubmit && (
            <TouchableOpacity onPress={doSubmit} style={{ paddingHorizontal: 12 }}>
              <Text style={{ fontSize: 16, fontWeight: '600' }}>Submit</Text>
            </TouchableOpacity>
          )}
          {showReceive && (
            <TouchableOpacity
              onPress={() => {
                if (!orderId) return Alert.alert('Receive', 'Missing order id.');
                navigation.navigate('Receive' as never, { orderId } as never);
              }}
              style={{ paddingHorizontal: 12 }}
            >
              <Text style={{ fontSize: 16, fontWeight: '600' }}>Receive</Text>
            </TouchableOpacity>
          )}
          {showInvoice && (
            <TouchableOpacity
              onPress={() => {
                if (!orderId) return Alert.alert('Invoice', 'Missing order id.');
                navigation.navigate('InvoiceEdit' as never, { orderId, status } as never);
              }}
              style={{ paddingHorizontal: 12 }}
            >
              <Text style={{ fontSize: 16, fontWeight: '600' }}>
                {status === 'received' ? 'Log Invoice' : 'Invoice'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      ),
    });
  }, [navigation, orderId, status, showSubmit, showReceive, showInvoice, doSubmit]);

  useFocusEffect(useCallback(() => { applyHeader(); return () => {}; }, [applyHeader]));
  useEffect(() => { applyHeader(); }, [applyHeader]);

  return <OriginalOrderDetailScreen {...props} />;
}
