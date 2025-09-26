import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, Modal, Text, TextInput,
  TouchableOpacity, View
} from 'react-native';
import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useVenueId } from '../../context/VenueProvider';
import { withErrorBoundary } from '../../components/ErrorCatcher';
import { dlog } from '../../utils/devlog';
import { throttleAction } from '../../utils/pressThrottle';
import { approveAdjustment, denyAdjustment, AdjustmentRequest } from '../../services/adjustments';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';

type MemberDoc = { role?: string };

function useIsManager(venueId?: string | null) {
  const [isManager, setIsManager] = useState(false);
  useEffect(() => {
    const auth = getAuth();
    let unsubMember: any;
    const unsubAuth = onAuthStateChanged(auth, async (u) => {
      if (!venueId || !u) { setIsManager(false); return; }
      try {
        // Owner or members/{uid} role:'manager'
        const vdoc = await getDoc(doc(db, 'venues', venueId));
        const ownerUid = (vdoc.data() as any)?.ownerUid;
        if (ownerUid && ownerUid === u.uid) { setIsManager(true); return; }

        unsubMember = onSnapshot(doc(db, 'venues', venueId, 'members', u.uid), (snap) => {
          const md = snap.data() as MemberDoc | undefined;
          setIsManager(md?.role === 'manager');
        });
      } catch {
        setIsManager(false);
      }
    });
    return () => { unsubAuth(); unsubMember && unsubMember(); };
  }, [venueId]);
  return isManager;
}

function AdjustmentInboxScreen() {
  const venueId = useVenueId();
  const isManager = useIsManager(venueId);

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<AdjustmentRequest[]>([]);
  const [denyFor, setDenyFor] = useState<AdjustmentRequest | null>(null);
  const [denyReason, setDenyReason] = useState('');

  useEffect(() => {
    if (!venueId) { setRows([]); setLoading(false); return; }
    setLoading(true);
    const q = query(
      collection(db, 'venues', venueId, 'sessions'),
      where('type', '==', 'stock-adjustment-request'),
      where('status', '==', 'pending'),
      orderBy('requestedAt', 'desc')
    );
    const unsub = onSnapshot(q, (snap) => {
      const out: AdjustmentRequest[] = [];
      snap.forEach((d) => out.push({ id: d.id, ...(d.data() as any) }));
      setRows(out);
      setLoading(false);
    }, (err) => {
      dlog('[Adjustments] snapshot error', err?.message);
      setRows([]); setLoading(false);
    });
    return () => unsub();
  }, [venueId]);

  const approve = throttleAction(async (req: AdjustmentRequest) => {
    try { await approveAdjustment(req); }
    catch (e: any) { Alert.alert('Approve failed', e?.message || 'Unknown error'); }
  });

  const openDeny = (req: AdjustmentRequest) => { setDenyFor(req); setDenyReason(''); };
  const submitDeny = throttleAction(async () => {
    if (!denyFor) return;
    try {
      await denyAdjustment(denyFor, denyReason.trim());
      setDenyFor(null); setDenyReason('');
    } catch (e: any) {
      Alert.alert('Deny failed', e?.message || 'Unknown error');
    }
  });

  const Empty = () => (
    <View style={{ padding: 24, alignItems: 'center' }}>
      <Text style={{ color: '#6B7280' }}>No pending adjustment requests.</Text>
    </View>
  );

  const Card = ({ item }: { item: AdjustmentRequest }) => (
    <View style={{ borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, padding: 12, gap: 6 }}>
      <Text style={{ fontWeight: '800' }}>{item.itemName || 'Item'}</Text>
      <Text style={{ color: '#374151' }}>
        Proposed: <Text style={{ fontWeight: '800' }}>{item.proposedQty}</Text>{'  '}
        From: <Text style={{ fontWeight: '800' }}>{item.fromQty ?? '—'}</Text>
      </Text>
      <Text style={{ color: '#6B7280' }}>Reason: {item.reason || '—'}</Text>
      <Text style={{ color: '#9CA3AF', fontSize: 12 }}>
        Requested by: {item.requestedBy || '—'}
      </Text>

      <View style={{ flexDirection: 'row', gap: 10, marginTop: 6 }}>
        <TouchableOpacity
          onPress={() => approve(item)}
          style={{ flex: 1, backgroundColor: '#10B981', paddingVertical: 10, borderRadius: 10, alignItems: 'center' }}
        >
          <Text style={{ color: 'white', fontWeight: '800' }}>Approve</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => openDeny(item)}
          style={{ flex: 1, backgroundColor: '#F59E0B', paddingVertical: 10, borderRadius: 10, alignItems: 'center' }}
        >
          <Text style={{ color: '#111827', fontWeight: '800' }}>Deny</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  if (!isManager) {
    return (
      <View style={{ flex:1, alignItems:'center', justifyContent:'center', padding:24 }}>
        <Text>You need manager rights to view this screen.</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, padding: 16, backgroundColor: 'white' }}>
      <Text style={{ fontSize: 20, fontWeight: '800', marginBottom: 12 }}>Adjustment Requests</Text>
      {loading ? (
        <View style={{ alignItems:'center', padding: 20 }}>
          <ActivityIndicator />
          <Text style={{ marginTop: 8, color: '#6B7280' }}>Loading…</Text>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.id}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          renderItem={Card}
          ListEmptyComponent={Empty}
          contentContainerStyle={{ paddingBottom: 20 }}
        />
      )}

      <Modal visible={!!denyFor} transparent animationType="fade" onRequestClose={() => setDenyFor(null)}>
        <View style={{ flex:1, backgroundColor:'rgba(0,0,0,0.35)', alignItems:'center', justifyContent:'center', padding:16 }}>
          <View style={{ backgroundColor:'white', borderRadius:12, padding:16, width:'100%', gap:10 }}>
            <Text style={{ fontWeight:'800', fontSize:16 }}>Deny request</Text>
            <Text>Provide a reason for denying this adjustment.</Text>
            <TextInput
              placeholder="Reason"
              value={denyReason}
              onChangeText={setDenyReason}
              style={{ borderWidth:1, borderColor:'#E5E7EB', borderRadius:10, paddingHorizontal:12, height:40, backgroundColor:'#F9FAFB' }}
            />
            <View style={{ flexDirection:'row', gap:10, marginTop:4 }}>
              <TouchableOpacity onPress={() => setDenyFor(null)} style={{ flex:1, padding:10, borderRadius:10, alignItems:'center', backgroundColor:'#E5E7EB' }}>
                <Text style={{ fontWeight:'700' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={submitDeny} disabled={!denyReason.trim()} style={{ flex:1, padding:10, borderRadius:10, alignItems:'center', backgroundColor: denyReason.trim() ? '#F59E0B' : '#FDE68A' }}>
                <Text style={{ fontWeight:'800', color:'#111827' }}>Confirm Deny</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

export default withErrorBoundary(AdjustmentInboxScreen, 'Adjustment Inbox');
