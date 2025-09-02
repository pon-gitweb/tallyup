import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, Alert } from 'react-native';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import OriginalOrderDetailScreen from './OrderDetailScreen';

import { getApp } from 'firebase/app';
import { getFirestore, doc, onSnapshot } from 'firebase/firestore';
import { useVenue } from '../../context/VenueProvider';

export default function OrderDetailWithHeader(props: any) {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { venueId } = useVenue() as any;

  const p = (route?.params as any) || {};
  const orderId: string | undefined = p?.orderId || p?.id || p?.order?.id;
  const paramStatus: string | undefined = p?.status || p?.order?.status;

  const [liveStatus, setLiveStatus] = useState<string | undefined>(undefined);

  // Subscribe to live order status so we don't depend on params
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
  const showReceive = useMemo(() => (!status || (status !== 'received' && status !== 'cancelled')), [status]);

  const applyHeader = useCallback(() => {
    console.log('[OrderDetailHeader v4] apply', { orderId, status, showReceive });
    navigation.setOptions({
      headerRight: () => (
        <View style={{ flexDirection: 'row' }}>
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
        </View>
      ),
    });
  }, [navigation, orderId, status, showReceive]);

  // Apply on focus and whenever inputs change
  useFocusEffect(useCallback(() => { applyHeader(); return () => {}; }, [applyHeader]));
  useEffect(() => { applyHeader(); }, [applyHeader]);

  return <OriginalOrderDetailScreen {...props} />;
}
