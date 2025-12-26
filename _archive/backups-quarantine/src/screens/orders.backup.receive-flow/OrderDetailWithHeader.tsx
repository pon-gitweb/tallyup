// @ts-nocheck
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, Alert } from 'react-native';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import OriginalOrderDetailScreen from './OrderDetailScreen';

import { getApp } from 'firebase/app';
import {
  getFirestore,
  doc,
  onSnapshot,
  updateDoc,
  serverTimestamp,
  collection,
  getDocs,
} from 'firebase/firestore';
import { useVenue } from '../../context/VenueProvider';

export default function OrderDetailWithHeader(props: any) {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { venueId, user } = useVenue() as any;

  const p = (route?.params as any) || {};
  const orderId: string | undefined = p?.orderId || p?.id || p?.order?.id;
  const paramStatus: string | undefined = p?.status || p?.order?.status;

  const [liveStatus, setLiveStatus] = useState<string | undefined>(undefined);

  // Live order status from Firestore
  useEffect(() => {
    if (!venueId || !orderId) return;
    const db = getFirestore(getApp());
    const ref = doc(db, 'venues', venueId, 'orders', orderId);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        const data = snap.data() as any;
        if (data && typeof data.status === 'string') {
          setLiveStatus((data.status || '').toString().toLowerCase());
        }
      },
      (err) => console.warn('[OrderDetailHeader v7] onSnapshot error', err)
    );
    return () => unsub();
  }, [venueId, orderId]);

  const status = useMemo(
    () => (liveStatus ?? paramStatus ?? '').toString().toLowerCase() || undefined,
    [liveStatus, paramStatus]
  );

  // Visibility (MVP)
  const showSubmit  = status === 'draft';
  const showReceive = status === 'submitted';
  const showInvoice = status === 'submitted' || status === 'received';

  const doSubmit = useCallback(async () => {
    try {
      if (!venueId || !orderId) throw new Error('Missing venue/order id.');
      const db = getFirestore(getApp());
      const orderRef = doc(db, 'venues', venueId, 'orders', orderId);

      // Guard: don't submit an empty draft
      const linesSnap = await getDocs(collection(orderRef, 'lines'));
      if (linesSnap.empty) {
        Alert.alert('Submit', 'This draft has no lines to submit.');
        return;
      }

      // Persist transition (idempotent)
      await updateDoc(orderRef, {
        status: 'submitted',
        displayStatus: 'Submitted',
        submittedAt: serverTimestamp(),
        submittedBy: user?.uid ?? null,
        updatedAt: serverTimestamp(),
      });

      // Optimistic; onSnapshot will confirm
      setLiveStatus('submitted');
      Alert.alert('Order', 'Order submitted.');
    } catch (e: any) {
      console.warn('[OrderDetailHeader v7] submit error', e);
      Alert.alert('Order', e?.message || 'Failed to submit order.');
    }
  }, [venueId, orderId, user?.uid]);

  const applyHeader = useCallback(() => {
    console.log('[OrderDetailHeader v7] apply', { orderId, status, showSubmit, showReceive, showInvoice });
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
