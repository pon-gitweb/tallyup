/* @ts-nocheck */
import React, {
  useMemo,
  useState,
  useCallback,
  useEffect,
} from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  TextInput,
} from 'react-native';
import { useVenueId } from '../../context/VenueProvider';
import { tryAttachToOrderOrSavePending } from '../../services/fastReceive/attachToOrder';

type FastRec = {
  id: string;
  source?: 'csv'|'pdf'|'manual'|string;
  storagePath?: string;
  parsedPo?: string|null;
  status?: 'pending'|'attached'|'reconciled';
  createdAt?: any; // Timestamp
  payload?: {
    invoice?: { source?: string; storagePath?: string; poNumber?: string|null };
    lines?: Array<{ name: string; qty: number; unitPrice?: number }>;
    confidence?: number|null;
    warnings?: string[];
  };
};

export default function FastReceiveDetailModal({
  visible,
  item,
  onClose,
  onAttached,
}: {
  visible: boolean;
  item: FastRec | null;
  onClose: () => void;
  onAttached: (orderId: string) => void;
}) {
  const venueId = useVenueId();
  const [busy, setBusy] = useState(false);

  // Editable copy of the OCR lines
  const [draftLines, setDraftLines] = useState<any[]>([]);

  useEffect(() => {
    if (item && Array.isArray(item?.payload?.lines)) {
      const cloned = item.payload.lines.map((l: any) => ({ ...l }));
      setDraftLines(cloned);
    } else {
      setDraftLines([]);
    }
  }, [item?.id]);

  const po = useMemo(
    () => item?.parsedPo ?? item?.payload?.invoice?.poNumber ?? '—',
    [item]
  );
  const when = useMemo(
    () => (item?.createdAt?.toDate ? item.createdAt.toDate().toISOString() : '—'),
    [item]
  );
  const src = useMemo(
    () => item?.source || item?.payload?.invoice?.source || '—',
    [item]
  );
  const path = useMemo(
    () => item?.storagePath || item?.payload?.invoice?.storagePath || '—',
    [item]
  );

  const lines = useMemo(() => draftLines, [draftLines]);
  const warnings = useMemo(() => item?.payload?.warnings || [], [item]);

  const totals = useMemo(() => {
    let n = 0;
    let sum = 0;
    for (const l of lines) {
      n += 1;
      const up = Number(l?.unitPrice ?? 0);
      const q = Number(l?.qty ?? 0);
      if (up > 0 && q > 0) sum += up * q;
    }
    return { count: n, extTotal: sum };
  }, [lines]);

  const updateLine = useCallback((idx: number, patch: { qty?: string; unitPrice?: string }) => {
    setDraftLines(prev => {
      const next = prev.slice();
      const current = next[idx] || {};
      let qty = current.qty;
      let unit = current.unitPrice;

      if (patch.qty !== undefined) {
        const raw = parseFloat(String(patch.qty).replace(/[^0-9.\-]/g, ''));
        qty = Number.isFinite(raw) && raw > 0 ? raw : 0;
      }
      if (patch.unitPrice !== undefined) {
        const raw = parseFloat(String(patch.unitPrice).replace(/[^0-9.\-]/g, ''));
        unit = Number.isFinite(raw) && raw >= 0 ? raw : 0;
      }

      next[idx] = {
        ...current,
        qty,
        unitPrice: unit,
      };
      return next;
    });
  }, []);

  const tryAttach = useCallback(async () => {
    try{
      if (!venueId) throw new Error('No venue selected');
      if (!item) throw new Error('No snapshot selected');
      setBusy(true);

      const effectiveLines = Array.isArray(lines) ? lines : [];

      const result = await tryAttachToOrderOrSavePending({
        venueId,
        parsed: {
          invoice: {
            poNumber: item?.parsedPo ?? item?.payload?.invoice?.poNumber ?? null,
            source: (item?.source || item?.payload?.invoice?.source || 'unknown') as any,
            storagePath: item?.storagePath || item?.payload?.invoice?.storagePath || '',
          },
          lines: effectiveLines,
          confidence: item?.payload?.confidence ?? null,
          warnings: item?.payload?.warnings ?? [],
        },
        storagePath: item?.storagePath || '',
        noPendingFallback: true,
      });

      if (result.attached && result.orderId) {
        Alert.alert('Attached', `Linked to order ${result.orderId} and sent for reconciliation.`);
        onAttached(result.orderId);
      } else {
        Alert.alert('Not Found', 'No submitted order matched this PO yet.');
      }
    } catch (e:any) {
      Alert.alert('Attach failed', String(e?.message||e));
    } finally {
      setBusy(false);
    }
  }, [venueId, item, lines, onAttached]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex:1, backgroundColor:'#fff' }}>
        <View style={S.header}>
          <TouchableOpacity onPress={onClose}><Text style={S.back}>‹ Back</Text></TouchableOpacity>
          <Text style={S.title}>Snapshot {item?.id ?? ''}</Text>
          <View style={{ width:60 }} />
        </View>

        <ScrollView style={{ flex:1 }}>
          <View style={{ padding:16, gap:12 }}>
            <View style={S.block}>
              <Text style={S.blockTitle}>Summary</Text>
              <Text style={S.kv}>PO: <Text style={S.v}>{po}</Text></Text>
              <Text style={S.kv}>Source: <Text style={S.v}>{src}</Text></Text>
              <Text style={S.kv}>Path: <Text style={S.v}>{path}</Text></Text>
              <Text style={S.kv}>Created: <Text style={S.v}>{when}</Text></Text>
              <Text style={S.kv}>Lines: <Text style={S.v}>{totals.count}</Text></Text>
              <Text style={S.kv}>Estimated Total: <Text style={S.v}>${totals.extTotal.toFixed(2)}</Text></Text>
            </View>

            <View style={S.block}>
              <Text style={S.blockTitle}>Lines (editable)</Text>
              <Text style={S.tip}>
                Fix any OCR mistakes here before attaching to an order.
              </Text>
              {lines.length === 0 ? (
                <Text style={S.dim}>No lines detected.</Text>
              ) : (
                lines.slice(0, 40).map((l, i) => (
                  <View key={`${i}-${l?.name}`} style={S.lineRow}>
                    <Text style={S.lineName} numberOfLines={2}>
                      {l?.name || '(unnamed)'}
                    </Text>
                    <View style={S.editRow}>
                      <View style={S.editField}>
                        <Text style={S.editLabel}>Qty</Text>
                        <TextInput
                          keyboardType="numeric"
                          value={
                            typeof l?.qty === 'number' && isFinite(l.qty)
                              ? String(l.qty)
                              : ''
                          }
                          onChangeText={(txt)=>updateLine(i, { qty: txt })}
                          style={S.input}
                        />
                      </View>
                      <View style={S.editField}>
                        <Text style={S.editLabel}>Unit</Text>
                        <TextInput
                          keyboardType="numeric"
                          value={
                            typeof l?.unitPrice === 'number' && isFinite(l.unitPrice)
                              ? String(l.unitPrice)
                              : ''
                          }
                          onChangeText={(txt)=>updateLine(i, { unitPrice: txt })}
                          style={S.input}
                        />
                      </View>
                    </View>
                  </View>
                ))
              )}
              {lines.length > 40 ? (
                <Text style={S.dim}>+ {lines.length - 40} more…</Text>
              ) : null}
            </View>

            {!!warnings?.length && (
              <View style={S.block}>
                <Text style={S.blockTitle}>Warnings</Text>
                {warnings.map((w, i) => (
                  <Text key={i} style={S.warn}>• {String(w)}</Text>
                ))}
              </View>
            )}
          </View>
        </ScrollView>

        <View style={S.footer}>
          <TouchableOpacity
            disabled={busy}
            onPress={tryAttach}
            style={[S.btn, { backgroundColor:'#111' }]}
          >
            <Text style={S.btnText}>{busy ? 'Attaching…' : 'Try Attach to Order'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            disabled={busy}
            onPress={onClose}
            style={[S.btn, { backgroundColor:'#F3F4F6' }]}
          >
            <Text style={[S.btnText, { color:'#111' }]}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const S = StyleSheet.create({
  header: { flexDirection:'row', alignItems:'center', justifyContent:'space-between', padding:12, borderBottomWidth:1, borderColor:'#E5E7EB' },
  back: { fontSize:18, color:'#2563EB', width:60 },
  title: { fontSize:18, fontWeight:'800' },

  block: { borderWidth:1, borderColor:'#E5E7EB', borderRadius:12, padding:12, backgroundColor:'#F9FAFB' },
  blockTitle: { fontWeight:'800', marginBottom:4 },
  kv: { color:'#374151', marginTop:2 },
  v: { fontWeight:'700' },

  lineRow: { paddingVertical:6, borderBottomWidth:StyleSheet.hairlineWidth, borderBottomColor:'#E5E7EB' },
  lineName: { fontWeight:'600', marginBottom:4 },
  editRow: { flexDirection:'row', gap:8 },
  editField: { flex:1 },
  editLabel: { fontSize:11, color:'#6B7280', marginBottom:2 },
  input: {
    borderWidth:1,
    borderColor:'#E5E7EB',
    borderRadius:8,
    paddingHorizontal:8,
    paddingVertical:6,
    backgroundColor:'#fff',
    fontSize:13,
  },

  dim: { color:'#94A3B8', marginTop:4 },
  tip: { color:'#6B7280', marginBottom:6, fontSize:12 },

  warn: { color:'#92400e', backgroundColor:'#fffbeb', paddingVertical:4, paddingHorizontal:8, borderRadius:8, marginTop:4 },

  footer: { flexDirection:'row', gap:10, padding:16, borderTopWidth:1, borderTopColor:'#E5E7EB' },
  btn: { flex:1, padding:14, borderRadius:12, alignItems:'center', justifyContent:'center' },
  btnText: { color:'#fff', fontWeight:'800' },
});
