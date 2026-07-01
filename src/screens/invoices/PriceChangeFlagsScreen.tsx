import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getFirestore, collection, query, where, orderBy, onSnapshot, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { useColours, useTheme } from '../../context/ThemeContext';
import { useVenueId } from '../../context/VenueProvider';
import { useToast } from '../../components/common/Toast';

type PriceFlag = {
  id: string;
  productName: string;
  oldPrice: number;
  newPrice: number;
  changePercent: number;
  direction: 'increase' | 'decrease';
  supplierName: string;
  invoiceId: string;
  flaggedAt: any;
  status: string;
};

export default function PriceChangeFlagsScreen({ navigation }: any) {
  const c = useColours();
  const { theme } = useTheme();
  const venueId = useVenueId();
  const { showSuccess, showError } = useToast();
  const [flags, setFlags] = useState<PriceFlag[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!venueId) return;
    const db = getFirestore();

    const unsub = onSnapshot(
      query(
        collection(db, 'venues', venueId, 'priceChangeFlags'),
        where('status', '==', 'pending'),
        orderBy('flaggedAt', 'desc')
      ),
      snap => {
        setFlags(snap.docs.map(d => ({ id: d.id, ...d.data() } as PriceFlag)));
        setLoading(false);
      },
      err => {
        console.error('[PriceFlags]', err);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [venueId]);

  async function handleAcknowledge(flagId: string) {
    try {
      const db = getFirestore();
      const auth = getAuth();
      await updateDoc(
        doc(db, 'venues', venueId!, 'priceChangeFlags', flagId),
        {
          status: 'acknowledged',
          acknowledgedBy: auth.currentUser?.uid,
          acknowledgedAt: serverTimestamp(),
        }
      );
      showSuccess('✓ Price change noted.');
    } catch (e) {
      showError('Could not update flag.');
    }
  }

  async function handleDismiss(flagId: string) {
    try {
      const db = getFirestore();
      await updateDoc(
        doc(db, 'venues', venueId!, 'priceChangeFlags', flagId),
        {
          status: 'dismissed',
          acknowledgedAt: serverTimestamp(),
        }
      );
    } catch (e) {
      showError('Could not dismiss flag.');
    }
  }

  function renderFlag({ item }: { item: PriceFlag }) {
    const isIncrease = item.direction === 'increase';
    const icon = isIncrease ? '⬆️' : '⬇️';
    const changeColor = isIncrease ? '#c0392b' : '#2d6a4f';

    const dateStr = item.flaggedAt?.toDate?.()?.toLocaleDateString('en-NZ', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }) || '';

    return (
      <View style={[styles.card, {
        backgroundColor: c.surface || '#ffffff',
        borderLeftWidth: 4,
        borderLeftColor: changeColor,
      }]}>
        <View style={styles.cardHeader}>
          <Text style={styles.icon}>{icon}</Text>
          <View style={{ flex: 1 }}>
            <Text style={[styles.productName, {
              color: c.missionSlate || '#3b3f4a',
              fontFamily: theme.fontBodySemiBold,
            }]}>
              {item.productName}
            </Text>
            <Text style={[styles.supplier, {
              color: c.slateMid || '#6b7280',
              fontFamily: theme.fontBody,
            }]}>
              {item.supplierName}
            </Text>
          </View>
        </View>

        <View style={styles.priceRow}>
          <Text style={[styles.oldPrice, {
            color: c.slateMid || '#6b7280',
            fontFamily: theme.fontBody,
          }]}>
            ${item.oldPrice.toFixed(2)}
          </Text>
          <Text style={[styles.arrow, { color: c.slateMid || '#6b7280' }]}>
            →
          </Text>
          <Text style={[styles.newPrice, {
            color: changeColor,
            fontFamily: theme.fontBodySemiBold,
          }]}>
            ${item.newPrice.toFixed(2)}
          </Text>
          <Text style={[styles.percent, {
            color: changeColor,
            fontFamily: theme.fontBody,
          }]}>
            {isIncrease ? '+' : ''}{item.changePercent.toFixed(1)}%
          </Text>
        </View>

        <Text style={[styles.date, {
          color: c.slateMid || '#6b7280',
          fontFamily: theme.fontBody,
        }]}>
          {dateStr}
        </Text>

        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.acknowledgeBtn, { backgroundColor: c.deepBlue || '#1b4f72' }]}
            onPress={() => handleAcknowledge(item.id)}
          >
            <Text style={[styles.acknowledgeBtnText, { fontFamily: theme.fontBodySemiBold }]}>
              Acknowledge
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.dismissBtn, { borderColor: c.border || '#e5e7eb' }]}
            onPress={() => handleDismiss(item.id)}
          >
            <Text style={[styles.dismissBtnText, {
              color: c.slateMid || '#6b7280',
              fontFamily: theme.fontBody,
            }]}>
              Dismiss
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={[styles.loading, { backgroundColor: c.oat || '#f5f3ee' }]}>
        <ActivityIndicator color={c.deepBlue || '#1b4f72'} />
      </View>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.oat || '#f5f3ee' }]} edges={['top', 'left', 'right']}>
      <FlatList
        keyboardShouldPersistTaps="handled"
        data={flags}
        keyExtractor={f => f.id}
        renderItem={renderFlag}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <Text style={[styles.heading, {
            color: c.missionSlate || '#3b3f4a',
            fontFamily: theme.fontTitle,
          }]}>
            Price Changes
          </Text>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>✓</Text>
            <Text style={[styles.emptyText, {
              color: c.slateMid || '#6b7280',
              fontFamily: theme.fontBody,
            }]}>
              No price changes to review.
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: 16, paddingBottom: 40 },
  heading: { fontSize: 26, marginBottom: 16 },
  card: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 },
  icon: { fontSize: 20, marginRight: 10 },
  productName: { fontSize: 15, marginBottom: 2 },
  supplier: { fontSize: 13 },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  oldPrice: { fontSize: 15, textDecorationLine: 'line-through' },
  arrow: { fontSize: 14 },
  newPrice: { fontSize: 18 },
  percent: { fontSize: 14 },
  date: { fontSize: 12, marginBottom: 14 },
  actions: { flexDirection: 'row', gap: 10 },
  acknowledgeBtn: {
    flex: 1,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  acknowledgeBtnText: { color: '#ffffff', fontSize: 14 },
  dismissBtn: {
    flex: 1,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  dismissBtnText: { fontSize: 14 },
  empty: { alignItems: 'center', padding: 48 },
  emptyIcon: { fontSize: 36, color: '#2d6a4f', marginBottom: 12 },
  emptyText: { fontSize: 15 },
});
