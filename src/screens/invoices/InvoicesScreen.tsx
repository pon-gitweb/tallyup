import React, { useEffect, useState } from 'react';
import { Alert, View, Text, ScrollView, TouchableOpacity, Modal, SafeAreaView } from 'react-native';
import { ToastHost } from '../../components/common/Toast';
import { getOfflineInvoiceQueue } from '../fastReceive/FastReceivePanel';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColours } from '../../context/ThemeContext';
import FastReceivePanel from '../stock/FastReceivePanel';
import FastReceivesReviewPanel from '../stock/FastReceivesReviewPanel';

export default function InvoicesScreen() {
  const nav = useNavigation<any>();
  const colours = useColours();
  const insets = useSafeAreaInsets();

  const [showFastReceive, setShowFastReceive] = useState(false);
  const [showFastReview, setShowFastReview] = useState(false);
  const [offlineCount, setOfflineCount] = useState(0);

  useEffect(() => {
    getOfflineInvoiceQueue().then(q => setOfflineCount(q.length));
  }, []);

  const actions = [
    {
      icon: '📷',
      label: 'Scan or upload invoice',
      sub: 'Camera, photo library, or PDF from email',
      onPress: () => setShowFastReceive(true),
    },
    {
      icon: '🕐',
      label: 'Fast receives pending',
      sub: 'Review invoices awaiting reconciliation',
      onPress: () => setShowFastReview(true),
    },
    {
      icon: '📦',
      label: 'Pending deliveries',
      sub: 'Submitted orders awaiting arrival',
      onPress: () => nav.navigate('PendingDeliveries'),
    },
    {
      icon: '🔁',
      label: 'Invoice reconciliations',
      sub: 'Match deliveries to invoices',
      onPress: () => nav.navigate('PendingDeliveries'),
    },
    {
      icon: '💳',
      label: 'Credit notes',
      sub: 'Record supplier credits',
      onPress: () => nav.navigate('CreditNoteForm'),
    },
    {
      icon: '🚩',
      label: 'Price changes',
      sub: 'Review flagged price differences',
      onPress: () => nav.navigate('PriceChangeFlags'),
    },
  ];

  return (
    <>
      <ScrollView
        style={{ flex: 1, backgroundColor: colours.cream }}
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ paddingHorizontal: 16, paddingTop: (insets.top || 0) + 16, paddingBottom: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
            <TouchableOpacity onPress={() => nav.goBack()} style={{ marginRight: 8, padding: 4 }}>
              <Text style={{ fontSize: 20, color: colours.deepBlue, fontWeight: '300' }}>‹</Text>
            </TouchableOpacity>
            <Text style={{ fontSize: 26, fontWeight: '700', color: colours.navy, letterSpacing: -0.5 }}>
              Invoices
            </Text>
          </View>
          <Text style={{ fontSize: 14, color: colours.textSecondary, marginTop: 4 }}>
            Scan deliveries, review pending stock, manage credits
          </Text>
        </View>

        <View style={{ paddingHorizontal: 16, marginTop: 8 }}>
          {offlineCount > 0 && (
            <TouchableOpacity
              onPress={() => Alert.alert(
                `${offlineCount} invoice${offlineCount > 1 ? 's' : ''} saved offline`,
                'Go to "Scan or upload invoice" and re-upload the files. Your originals are saved on your device.',
                [{ text: 'OK' }]
              )}
              style={{
                backgroundColor: '#fef9c3',
                borderRadius: 12, padding: 14,
                borderWidth: 1.5, borderColor: '#c47b2b',
                flexDirection: 'row', alignItems: 'center', gap: 10,
                marginBottom: 8,
              }}
            >
              <Text style={{ fontSize: 20 }}>📋</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14, fontWeight: '800', color: '#92400e' }}>
                  {offlineCount} invoice{offlineCount > 1 ? 's' : ''} saved offline
                </Text>
                <Text style={{ fontSize: 12, color: '#92400e', marginTop: 2 }}>
                  Tap to process now you're back online
                </Text>
              </View>
              <Text style={{ fontSize: 18, color: '#c47b2b' }}>→</Text>
            </TouchableOpacity>
          )}
          {actions.map((action, i) => (
            <TouchableOpacity
              key={i}
              onPress={action.onPress}
              activeOpacity={0.75}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: colours.surface,
                borderRadius: 12,
                padding: 16,
                marginBottom: 10,
                borderWidth: 1,
                borderColor: colours.border,
              }}
            >
              <Text style={{ fontSize: 22, marginRight: 14 }}>{action.icon}</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 15, fontWeight: '600', color: colours.navy }}>{action.label}</Text>
                <Text style={{ fontSize: 13, color: colours.textSecondary, marginTop: 2 }}>{action.sub}</Text>
              </View>
              <Text style={{ fontSize: 18, color: colours.deepBlue, fontWeight: '300' }}>›</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      {/* Fast Receive (Scan/Upload) */}
      <Modal visible={showFastReceive} animationType="slide" onRequestClose={() => setShowFastReceive(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: 'white' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12, borderBottomWidth: 1, borderColor: '#E5E7EB' }}>
            <TouchableOpacity onPress={() => setShowFastReceive(false)}>
              <Text style={{ fontSize: 18, color: '#2563EB', width: 60 }}>‹ Back</Text>
            </TouchableOpacity>
            <Text style={{ fontSize: 18, fontWeight: '800' }}>Fast Receive</Text>
            <View style={{ width: 60 }} />
          </View>
          <FastReceivePanel onClose={() => setShowFastReceive(false)} />
          <ToastHost />
        </SafeAreaView>
      </Modal>

      {/* Fast Receives (Pending Review/Attach) */}
      <Modal visible={showFastReview} animationType="slide" onRequestClose={() => setShowFastReview(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: 'white' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12, borderBottomWidth: 1, borderColor: '#E5E7EB' }}>
            <TouchableOpacity onPress={() => setShowFastReview(false)}>
              <Text style={{ fontSize: 18, color: '#2563EB', width: 60 }}>‹ Back</Text>
            </TouchableOpacity>
            <Text style={{ fontSize: 18, fontWeight: '800' }}>Fast Receives (Pending)</Text>
            <View style={{ width: 60 }} />
          </View>
          <FastReceivesReviewPanel onClose={() => setShowFastReview(false)} />
        </SafeAreaView>
      </Modal>
    </>
  );
}
