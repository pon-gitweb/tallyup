import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, Modal, Text, TextInput,
  TouchableOpacity, View, ScrollView
} from 'react-native';
import { collection, onSnapshot, orderBy, query, where, doc, getDoc } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useVenueId } from '../../context/VenueProvider';
import { withErrorBoundary } from '../../components/ErrorCatcher';
import { dlog } from '../../utils/devlog';
import { throttleAction } from '../../utils/pressThrottle';
import { approveAdjustment, denyAdjustment, AdjustmentRequest } from '../../services/adjustments';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import { useNavigation } from '@react-navigation/native';
import { useDepartments } from '../../hooks/useDepartments';

type MemberDoc = { role?: string };

function useIsManager(venueId?: string | null) {
  const [isManager, setIsManager] = useState(false);
  useEffect(() => {
    const auth = getAuth();
    let unsubMember: any;
    const unsubAuth = onAuthStateChanged(auth, async (u) => {
      if (!venueId || !u) { setIsManager(false); return; }
      try {
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
  const nav = useNavigation<any>();
  const venueId = useVenueId();
  const isManager = useIsManager(venueId);
  const uid = getAuth().currentUser?.uid ?? null;

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<AdjustmentRequest[]>([]);
  const [denyFor, setDenyFor] = useState<AdjustmentRequest | null>(null);
  const [denyReason, setDenyReason] = useState('');

  // Departments for filtering
  const { items: departments } = useDepartments(venueId);
  const [deptFilter, setDeptFilter] = useState<string | null>(null); // null = All

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

  const filteredRows = useMemo(() => {
    if (!deptFilter) return rows;
    return rows.filter(r => r.departmentId === deptFilter);
  }, [rows, deptFilter]);

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

  const DeptChips = () => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingVertical: 6, gap: 8 }}>
      <TouchableOpacity
        onPress={() => setDeptFilter(null)}
        style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, borderWidth: 1,
                 borderColor: deptFilter == null ? '#0A84FF' : '#E5E7EB', backgroundColor: deptFilter == null ? '#D6E9FF' : 'white' }}
      >
        <Text style={{ fontWeight: '700', color: '#0A84FF' }}>All</Text>
      </TouchableOpacity>
      {departments.map(d => (
        <TouchableOpacity
          key={d.id}
          onPress={() => setDeptFilter(d.id === deptFilter ? null : d.id)}
          style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, borderWidth: 1,
                   borderColor: d.id === deptFilter ? '#0A84FF' : '#E5E7EB', backgroundColor: d.id === deptFilter ? '#D6E9FF' : 'white' }}
        >
          <Text style={{ fontWeight: '700', color: '#0A84FF' }}>{d.name}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );

  const Card = ({ item }: { item: AdjustmentRequest }) => {
    const selfRequest = !!(uid && item.requestedBy && uid === item.requestedBy);
    return (
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={() => nav.navigate('AdjustmentDetail', {
          requestId: item.id,
          itemId: item.itemId,
          itemName: item.itemName,
          departmentId: item.departmentId,
          areaId: item.areaId,
          proposedQty: item.proposedQty,
          fromQty: item.fromQty ?? null,
          reason: item.reason || '',
          requestedBy: item.requestedBy || null,
        })}
        style={{ borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, padding: 12, gap: 6 }}
      >
        <Text style={{ fontWeight: '800' }}>{item.itemName || 'Item'}</Text>
        <Text style={{ color: '#374151' }}>
          Proposed: <Text style={{ fontWeight: '800' }}>{item.proposedQty}</Text>{'  '}
          From: <Text style={{ fontWeight: '800' }}>{item.fromQty ?? '—'}</Text>
        </Text>
        <Text style={{ color: '#6B7280' }}>Reason: {item.reason || '—'}</Text>
        <Text style={{ color: '#9CA3AF', fontSize: 12 }}>
          Requested by: {item.requestedBy || '—'} {selfRequest ? '(you)' : ''}
        </Text>

        {selfRequest ? (
          <Text style={{ color: '#EF4444', fontSize: 12, marginTop: 4 }}>
            Needs another manager — you can’t approve your own request.
          </Text>
        ) : null}

        <View style={{ flexDirection: 'row', gap: 10, marginTop: 6 }}>
          <TouchableOpacity
            onPress={() => selfRequest ? Alert.alert('Not allowed', 'Another manager must approve your request.') : approve(item)}
            disabled={selfRequest}
            style={{
              flex: 1,
              backgroundColor: selfRequest ? '#9CA3AF' : '#10B981',
              paddingVertical: 10, borderRadius: 10, alignItems: 'center'
            }}
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
      </TouchableOpacity>
    );
  };

  if (!isManager) {
    return (
      <View style={{ flex:1, alignItems:'center', justifyContent:'center', padding:24 }}>
        <Text>You need manager rights to view this screen.</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, padding: 16, backgroundColor: 'white' }}>
      <Text style={{ fontSize: 20, fontWeight: '800', marginBottom: 8 }}>Adjustment Requests</Text>
      <DeptChips />
      {loading ? (
        <View style={{ alignItems:'center', padding: 20 }}>
          <ActivityIndicator />
          <Text style={{ marginTop: 8, color: '#6B7280' }}>Loading…</Text>
        </View>
      ) : (
        <FlatList
          data={filteredRows}
          keyExtractor={(r) => r.id}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          renderItem={({ item }) => <Card item={item} />}
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
              <TouchableOpacity onPress={() => denyReason.trim() ? undefined : null} disabled={!denyReason.trim()} style={{ flex:1, padding:10, borderRadius:10, alignItems:'center', backgroundColor: denyReason.trim() ? '#F59E0B' : '#FDE68A' }}>
                <Text style={{ fontWeight:'800', color:'#111827' }} onPress={denyReason.trim() ? submitDeny : undefined}>Confirm Deny</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

export default withErrorBoundary(AdjustmentInboxScreen, 'Adjustment Inbox');
