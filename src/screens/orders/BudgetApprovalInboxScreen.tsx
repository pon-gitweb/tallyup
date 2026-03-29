// @ts-nocheck
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, Text,
  TextInput, TouchableOpacity, View, Modal
} from 'react-native';
import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useVenueId } from '../../context/VenueProvider';
import { withErrorBoundary } from '../../components/ErrorCatcher';
import {
  approveBudgetOverride, rejectBudgetOverride, BudgetOverrideRequest
} from '../../services/budgetApprovals';

function BudgetApprovalInboxScreen() {
  const venueId = useVenueId();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<BudgetOverrideRequest[]>([]);
  const [rejectFor, setRejectFor] = useState<BudgetOverrideRequest | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!venueId) { setRows([]); setLoading(false); return; }
    const q = query(
      collection(db, 'venues', venueId, 'sessions'),
      where('type', '==', 'budget-override-request'),
      where('status', '==', 'pending'),
      orderBy('requestedAt', 'desc'),
    );
    const unsub = onSnapshot(q, snap => {
      const out: BudgetOverrideRequest[] = [];
      snap.forEach(d => out.push({ id: d.id, ...(d.data() as any) }));
      setRows(out);
      setLoading(false);
    }, () => { setRows([]); setLoading(false); });
    return () => unsub();
  }, [venueId]);

  const onApprove = async (req: BudgetOverrideRequest) => {
    Alert.alert(
      'Approve override?',
      'This will submit the order and exceed the budget by $' + req.overBy.toFixed(2) + '.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Approve', onPress: async () => {
            try {
              setBusy(true);
              await approveBudgetOverride(venueId, req);
              Alert.alert('Approved', 'Order has been submitted.');
            } catch (e: any) {
              Alert.alert('Failed', e?.message || 'Could not approve.');
            } finally { setBusy(false); }
          }
        }
      ]
    );
  };

  const onReject = async () => {
    if (!rejectFor) return;
    try {
      setBusy(true);
      await rejectBudgetOverride(venueId, rejectFor, rejectNote);
      setRejectFor(null);
      setRejectNote('');
      Alert.alert('Rejected', 'Order returned to draft.');
    } catch (e: any) {
      Alert.alert('Failed', e?.message || 'Could not reject.');
    } finally { setBusy(false); }
  };

  if (loading) {
    return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator /></View>;
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#fff', padding: 16 }}>
      <Text style={{ fontSize: 22, fontWeight: '900', marginBottom: 4 }}>Budget Approvals</Text>
      <Text style={{ color: '#6B7280', marginBottom: 16 }}>
        Orders that exceeded budget and need your approval.
      </Text>

      <FlatList
        data={rows}
        keyExtractor={r => r.id}
        ListEmptyComponent={
          <View style={{ paddingTop: 48, alignItems: 'center' }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: '#374151' }}>All clear</Text>
            <Text style={{ color: '#6B7280', marginTop: 4 }}>No pending budget overrides.</Text>
          </View>
        }
        ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
        renderItem={({ item: req }) => (
          <View style={{
            backgroundColor: '#FEF2F2', borderRadius: 14, padding: 14,
            borderWidth: 1, borderColor: '#FECACA'
          }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontWeight: '900', fontSize: 16, color: '#111' }}>
                {req.supplierName || 'Order'}
              </Text>
              <View style={{ backgroundColor: '#FEE2E2', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 }}>
                <Text style={{ fontSize: 12, fontWeight: '700', color: '#B91C1C' }}>Over budget</Text>
              </View>
            </View>
            <Text style={{ color: '#6B7280', marginTop: 4, fontSize: 13 }}>
              Requested by: {req.requestedByName || 'Staff member'}
            </Text>
            <View style={{ marginTop: 10, padding: 10, backgroundColor: '#fff', borderRadius: 10, gap: 4 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: '#6B7280' }}>Order total</Text>
                <Text style={{ fontWeight: '800' }}>${req.orderTotal.toFixed(2)}</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: '#6B7280' }}>Budget limit</Text>
                <Text style={{ fontWeight: '800' }}>${req.budgetAmount.toFixed(2)}</Text>
              </View>
              <View style={{ height: 1, backgroundColor: '#F3F4F6', marginVertical: 4 }} />
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontWeight: '800', color: '#B91C1C' }}>Over by</Text>
                <Text style={{ fontWeight: '900', color: '#B91C1C' }}>${req.overBy.toFixed(2)}</Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
              <TouchableOpacity
                disabled={busy}
                onPress={() => { setRejectFor(req); setRejectNote(''); }}
                style={{ flex: 1, padding: 12, borderRadius: 10, backgroundColor: '#F3F4F6', alignItems: 'center' }}
              >
                <Text style={{ fontWeight: '800', color: '#374151' }}>Reject</Text>
              </TouchableOpacity>
              <TouchableOpacity
                disabled={busy}
                onPress={() => onApprove(req)}
                style={{ flex: 1, padding: 12, borderRadius: 10, backgroundColor: '#16A34A', alignItems: 'center' }}
              >
                <Text style={{ fontWeight: '800', color: '#fff' }}>Approve</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      />

      {/* Reject modal */}
      <Modal visible={!!rejectFor} transparent animationType="fade" onRequestClose={() => setRejectFor(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16 }}>
            <Text style={{ fontSize: 18, fontWeight: '900', marginBottom: 8 }}>Reject override</Text>
            <Text style={{ color: '#6B7280', marginBottom: 12 }}>
              Order will be returned to draft. Staff member will need to reduce the order or get approval.
            </Text>
            <TextInput
              value={rejectNote}
              onChangeText={setRejectNote}
              placeholder="Reason (optional)..."
              style={{ borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 10, padding: 12, marginBottom: 12 }}
              multiline
            />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity
                onPress={() => setRejectFor(null)}
                style={{ flex: 1, padding: 14, borderRadius: 12, backgroundColor: '#F3F4F6', alignItems: 'center' }}
              >
                <Text style={{ fontWeight: '700' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                disabled={busy}
                onPress={onReject}
                style={{ flex: 1, padding: 14, borderRadius: 12, backgroundColor: '#DC2626', alignItems: 'center' }}
              >
                <Text style={{ fontWeight: '800', color: '#fff' }}>{busy ? 'Rejecting...' : 'Reject'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

export default withErrorBoundary(BudgetApprovalInboxScreen, 'BudgetApprovalInbox');
