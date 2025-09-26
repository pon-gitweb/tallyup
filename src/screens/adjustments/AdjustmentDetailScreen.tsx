import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { RouteProp, useRoute } from '@react-navigation/native';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useVenueId } from '../../context/VenueProvider';
import { fetchRecentItemAudits, AuditEntry } from '../../services/audits';
import { withErrorBoundary } from '../../components/ErrorCatcher';

type Params = {
  AdjustmentDetail: {
    requestId: string;
    itemId: string;
    itemName?: string;
    departmentId: string;
    areaId: string;
    proposedQty: number;
    fromQty?: number|null;
    reason?: string;
    requestedBy?: string|null;
  };
};

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', marginBottom: 6 }}>
      <Text style={{ width: 110, color: '#6B7280' }}>{label}</Text>
      <Text style={{ flex: 1, fontWeight: '600' }}>{String(value ?? '—')}</Text>
    </View>
  );
}

function AuditCard({ a }: { a: AuditEntry }) {
  return (
    <View style={{ borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 10, padding: 10 }}>
      <Text style={{ fontWeight: '800', marginBottom: 2 }}>{a.type.replace(/-/g, ' ')}</Text>
      <Text style={{ color: '#374151' }}>
        {a.fromQty != null ? `From ${a.fromQty} → ` : ''}{a.toQty != null ? `To ${a.toQty}` : ''}
      </Text>
      {a.decisionNote ? <Text style={{ color: '#6B7280', marginTop: 2 }}>Note: {a.decisionNote}</Text> : null}
      <Text style={{ color: '#9CA3AF', fontSize: 12, marginTop: 4 }}>
        {a.createdAt?.toDate ? a.createdAt.toDate().toLocaleString() : '—'}
      </Text>
    </View>
  );
}

function AdjustmentDetailScreen() {
  const venueId = useVenueId();
  const { params } = useRoute<RouteProp<Params, 'AdjustmentDetail'>>();
  const [itemDoc, setItemDoc] = useState<any | null>(null);
  const [audits, setAudits] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!venueId) return;
        const iref = doc(db, 'venues', venueId, 'departments', params.departmentId, 'areas', params.areaId, 'items', params.itemId);
        const isnap = await getDoc(iref);
        const audits = await fetchRecentItemAudits(venueId, params.itemId, 20);
        if (!alive) return;
        setItemDoc(isnap.exists() ? isnap.data() : null);
        setAudits(audits);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [venueId, params.itemId]);

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32, backgroundColor: 'white' }}>
      <Text style={{ fontSize: 20, fontWeight: '800', marginBottom: 12 }}>Adjustment Detail</Text>

      {/* Request overview */}
      <View style={{ borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, padding: 12, marginBottom: 12 }}>
        <Row label="Item" value={params.itemName || 'Item'} />
        <Row label="Proposed" value={params.proposedQty} />
        <Row label="From" value={params.fromQty ?? '—'} />
        <Row label="Reason" value={params.reason || '—'} />
        <Row label="Requested by" value={params.requestedBy || '—'} />
      </View>

      {/* Live item snapshot */}
      <View style={{ borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, padding: 12, marginBottom: 12 }}>
        <Text style={{ fontWeight: '800', marginBottom: 6 }}>Current Item Snapshot</Text>
        {loading ? (
          <View style={{ flexDirection:'row', alignItems:'center', gap:8 }}>
            <ActivityIndicator /><Text>Loading item…</Text>
          </View>
        ) : itemDoc ? (
          <>
            <Row label="Last Count" value={itemDoc.lastCount ?? '—'} />
            <Row label="Expected" value={itemDoc.expectedQty ?? '—'} />
            <Row label="UOM" value={itemDoc.uom || '—'} />
          </>
        ) : (
          <Text style={{ color: '#EF4444' }}>Item not found (may have been removed).</Text>
        )}
      </View>

      {/* Recent audits */}
      <View style={{ borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, padding: 12 }}>
        <Text style={{ fontWeight: '800', marginBottom: 8 }}>Recent Audit Trail</Text>
        {loading ? (
          <View style={{ flexDirection:'row', alignItems:'center', gap:8 }}>
            <ActivityIndicator /><Text>Loading audits…</Text>
          </View>
        ) : audits.length === 0 ? (
          <Text style={{ color: '#6B7280' }}>No recent audits for this item.</Text>
        ) : (
          <View style={{ gap: 8 }}>
            {audits.map(a => <AuditCard key={a.id} a={a} />)}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

export default withErrorBoundary(AdjustmentDetailScreen, 'Adjustment Detail');
