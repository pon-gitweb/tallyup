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
  TextInput,
  KeyboardAvoidingView,
  TouchableWithoutFeedback,
  Keyboard,
  Platform,
} from 'react-native';
import { SafeAreaView, SafeAreaProvider } from 'react-native-safe-area-context';
import { useVenueId } from '../../context/VenueProvider';
import { useToast } from '../../components/common/Toast';
import { tryAttachToOrderOrSavePending } from '../../services/fastReceive/attachToOrder';
import { commitInvoiceDecisions } from '../../services/fastReceive/commitInvoiceDecisions';

type ProposedAction =
  | { id: string; type: 'priceChange'; productId: string; productName: string; lineName: string;
      oldPrice: number; newPrice: number; changePercent: number; direction: 'increase'|'decrease';
      qty: number; caseSize: number|null }
  | { id: string; type: 'nearDuplicateMatch'; candidateProductId: string; candidateProductName: string;
      lineName: string; existingPrice: number|null; newPrice: number; qty: number; caseSize: number|null }
  | { id: string; type: 'newProduct'; lineName: string; unitPrice: number; qty: number;
      caseSize: number|null; supplierId: string|null; supplierName: string|null }
  | { id: string; type: 'supplierLink'; productId: string; productName: string; supplierId: string;
      supplierName: string|null; unitCost: number; caseSize: number|null; wouldBecomePreferred: boolean };

type FastRec = {
  id: string;
  source?: 'csv'|'pdf'|'manual'|string;
  storagePath?: string;
  parsedPo?: string|null;
  status?: 'pending'|'attached'|'reconciled';
  createdAt?: any; // Timestamp
  inductionDecisions?: {
    acceptedProposalIds: string[];
    skippedProposalIds: string[];
    supplierAccepted: boolean;
    resolvedSupplierId: string|null;
    resolvedAt?: any;
  };
  payload?: {
    invoice?: { source?: string; storagePath?: string; poNumber?: string|null;
                supplierId?: string|null; supplierName?: string|null };
    lines?: Array<{ name: string; qty: number; unitPrice?: number }>;
    confidence?: number|null;
    warnings?: string[];
    supplierCandidate?: { name: string; phone: string|null; email: string|null;
                          address: string|null; accountNumber: string|null };
    proposals?: ProposedAction[];
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
  const { showSuccess, showInfo, showError } = useToast();
  const [busy, setBusy] = useState(false);

  // Editable copy of the OCR lines
  const [draftLines, setDraftLines] = useState<any[]>([]);

  // Decision state — kept separate so TextInput edits never re-render these
  const [supplierDecision, setSupplierDecision] = useState<'accept'|'skip'|null>(null);
  const [proposalDecisions, setProposalDecisions] = useState<Record<string, 'accept'|'skip'>>({});
  const [committing, setCommitting] = useState(false);

  useEffect(() => {
    if (item && Array.isArray(item?.payload?.lines)) {
      const cloned = item.payload.lines.map((l: any) => ({ ...l }));
      setDraftLines(cloned);
    } else {
      setDraftLines([]);
    }
  }, [item?.id]);

  useEffect(() => {
    setSupplierDecision(null);
    setProposalDecisions({});
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

  const proposals = useMemo<ProposedAction[]>(
    () => (Array.isArray(item?.payload?.proposals) ? item.payload.proposals : []),
    [item],
  );
  const supplierCandidate = useMemo(() => item?.payload?.supplierCandidate ?? null, [item]);
  const resolvedSupplierId = useMemo(() => item?.payload?.invoice?.supplierId ?? null, [item]);
  const inductionDecisions = useMemo(() => item?.inductionDecisions ?? null, [item]);
  const needsSupplierDecision = !resolvedSupplierId && !!supplierCandidate;
  const hasReviewItems = proposals.length > 0 || !!supplierCandidate;
  const allDecided = useMemo(() => {
    if (!hasReviewItems || !!inductionDecisions) return true;
    if (needsSupplierDecision && supplierDecision === null) return false;
    return proposals.every(p => p.id in proposalDecisions);
  }, [hasReviewItems, inductionDecisions, needsSupplierDecision, supplierDecision, proposals, proposalDecisions]);

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
        showSuccess(`Linked to order ${result.orderId} and sent for reconciliation.`);
        onAttached(result.orderId);
      } else {
        showInfo('No submitted order matched this PO yet.');
      }
    } catch (e:any) {
      showError(String(e?.message||e));
    } finally {
      setBusy(false);
    }
  }, [venueId, item, lines, onAttached]);

  const acceptAll = useCallback(() => {
    const next: Record<string, 'accept'|'skip'> = {};
    for (const p of proposals) next[p.id] = 'accept';
    setProposalDecisions(next);
  }, [proposals]);

  const setProposalDecision = useCallback((id: string, decision: 'accept'|'skip') => {
    setProposalDecisions(prev => ({ ...prev, [id]: decision }));
  }, []);

  const commitChanges = useCallback(async () => {
    try {
      if (!venueId || !item) throw new Error('No venue or snapshot');
      setCommitting(true);
      const acceptedIds = proposals
        .filter(p => proposalDecisions[p.id] === 'accept')
        .map(p => p.id);
      const result = await commitInvoiceDecisions({
        venueId,
        snapshotId: item.id,
        acceptedProposalIds: acceptedIds,
        acceptSupplierCandidate: supplierDecision === 'accept',
      });
      const total = (result.changed ?? 0) + (result.created ?? 0);
      const skipped = result.skipped ?? 0;
      showSuccess(
        `Applied ${total} change${total === 1 ? '' : 's'}${skipped ? `, ${skipped} skipped` : ''}.`
      );
      onClose();
    } catch (e: any) {
      showError(String(e?.message || e));
    } finally {
      setCommitting(false);
    }
  }, [venueId, item, proposals, proposalDecisions, supplierDecision, onClose]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaProvider>
        <SafeAreaView style={{ flex:1, backgroundColor:'#fff' }} edges={['top','left','right']}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex:1 }}>
            <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
              <View style={{ flex:1 }}>
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

            {/* Supplier — shown only when relevant */}
            {!!resolvedSupplierId && (
              <View style={S.block}>
                <Text style={S.blockTitle}>Supplier</Text>
                <Text style={S.kv}>Matched: <Text style={S.v}>{item?.payload?.invoice?.supplierName || '—'}</Text></Text>
              </View>
            )}
            {!resolvedSupplierId && !!supplierCandidate && !inductionDecisions && (
              <View style={[S.block, { backgroundColor:'#fffbeb', borderColor:'#fcd34d' }]}>
                <Text style={[S.blockTitle, { color:'#92400e' }]}>New supplier detected</Text>
                <Text style={[S.kv, { color:'#92400e', fontWeight:'700', marginBottom:4 }]}>
                  {supplierCandidate.name}
                </Text>
                {!!supplierCandidate.phone && (
                  <Text style={[S.kv, { color:'#92400e' }]}>Phone: {supplierCandidate.phone}</Text>
                )}
                {!!supplierCandidate.email && (
                  <Text style={[S.kv, { color:'#92400e' }]}>Email: {supplierCandidate.email}</Text>
                )}
                {!!supplierCandidate.address && (
                  <Text style={[S.kv, { color:'#92400e' }]}>Address: {supplierCandidate.address}</Text>
                )}
                <View style={S.decisionRow}>
                  {supplierDecision === null ? (
                    <>
                      <TouchableOpacity
                        style={[S.smallBtn, { backgroundColor:'#16a34a' }]}
                        onPress={() => setSupplierDecision('accept')}
                      >
                        <Text style={S.smallBtnText}>Add supplier</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[S.smallBtn, { backgroundColor:'#6B7280' }]}
                        onPress={() => setSupplierDecision('skip')}
                      >
                        <Text style={S.smallBtnText}>Skip</Text>
                      </TouchableOpacity>
                    </>
                  ) : (
                    <>
                      <Text style={{ color: supplierDecision === 'accept' ? '#16a34a' : '#6B7280', fontWeight:'700', flex:1, fontSize:13 }}>
                        {supplierDecision === 'accept' ? '✓ Will be added' : '— Skipped'}
                      </Text>
                      <TouchableOpacity
                        style={[S.smallBtn, { backgroundColor:'#E5E7EB' }]}
                        onPress={() => setSupplierDecision(null)}
                      >
                        <Text style={[S.smallBtnText, { color:'#374151' }]}>Change</Text>
                      </TouchableOpacity>
                    </>
                  )}
                </View>
              </View>
            )}

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

            {/* Proposed changes — interactive, shown only when not yet resolved */}
            {!inductionDecisions && proposals.length > 0 && (
              <View style={S.block}>
                <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
                  <Text style={S.blockTitle}>
                    {proposals.length} change{proposals.length === 1 ? '' : 's'} to review
                  </Text>
                  <TouchableOpacity
                    style={[S.smallBtn, { backgroundColor:'#2563EB' }]}
                    onPress={acceptAll}
                  >
                    <Text style={S.smallBtnText}>Accept All</Text>
                  </TouchableOpacity>
                </View>
                {proposals.map(p => (
                  <ProposalCard
                    key={p.id}
                    proposal={p}
                    decision={proposalDecisions[p.id] ?? null}
                    onDecide={setProposalDecision}
                  />
                ))}
              </View>
            )}

            {/* Already-resolved — read-only summary shown when decisions were previously committed */}
            {!!inductionDecisions && hasReviewItems && (
              <View style={[S.block, { backgroundColor:'#f0fdf4', borderColor:'#86efac' }]}>
                <Text style={[S.blockTitle, { color:'#166534' }]}>Changes Reviewed</Text>
                <Text style={S.kv}>
                  Accepted: <Text style={S.v}>{inductionDecisions.acceptedProposalIds?.length ?? 0}</Text>
                </Text>
                <Text style={S.kv}>
                  Skipped: <Text style={S.v}>{inductionDecisions.skippedProposalIds?.length ?? 0}</Text>
                </Text>
                {inductionDecisions.resolvedAt?.toDate && (
                  <Text style={S.kv}>
                    Reviewed: <Text style={S.v}>
                      {inductionDecisions.resolvedAt.toDate().toLocaleDateString('en-NZ')}
                    </Text>
                  </Text>
                )}
              </View>
            )}
          </View>
        </ScrollView>

        <View style={[S.footer, { flexDirection:'column', gap:8 }]}>
          {hasReviewItems && !inductionDecisions && (
            <TouchableOpacity
              disabled={committing || !allDecided}
              onPress={commitChanges}
              style={{
                padding:14,
                borderRadius:12,
                alignItems:'center',
                justifyContent:'center',
                backgroundColor: allDecided ? '#16a34a' : '#9CA3AF',
                opacity: committing ? 0.7 : 1,
              }}
            >
              <Text style={S.btnText}>{committing ? 'Applying…' : 'Confirm Changes'}</Text>
            </TouchableOpacity>
          )}
          <View style={{ flexDirection:'row', gap:10 }}>
            <TouchableOpacity
              disabled={busy || committing}
              onPress={tryAttach}
              style={[S.btn, { backgroundColor:'#111' }]}
            >
              <Text style={S.btnText}>{busy ? 'Attaching…' : 'Try Attach to Order'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              disabled={busy || committing}
              onPress={onClose}
              style={[S.btn, { backgroundColor:'#F3F4F6' }]}
            >
              <Text style={[S.btnText, { color:'#111' }]}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
              </View>
            </TouchableWithoutFeedback>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

function ProposalCard({ proposal, decision, onDecide }: any) {
  let heading = '';
  let detail = '';

  if (proposal.type === 'priceChange') {
    heading = `${proposal.productName}: $${proposal.oldPrice.toFixed(2)} → $${proposal.newPrice.toFixed(2)}`;
    detail = `${proposal.direction === 'increase' ? '↑' : '↓'} ${Math.abs(proposal.changePercent).toFixed(1)}%`;
  } else if (proposal.type === 'nearDuplicateMatch') {
    heading = `'${proposal.lineName}' looks like '${proposal.candidateProductName}'`;
    detail = proposal.existingPrice != null
      ? `Price: $${proposal.existingPrice.toFixed(2)} → $${proposal.newPrice.toFixed(2)}`
      : `First time — $${proposal.newPrice.toFixed(2)}`;
  } else if (proposal.type === 'newProduct') {
    heading = `${proposal.lineName} — add as new product?`;
    detail = proposal.unitPrice == null
      ? 'No price detected — will need a price added later'
      : proposal.caseSize
        ? `$${proposal.unitPrice.toFixed(2)} / $${(proposal.unitPrice / proposal.caseSize).toFixed(2)} per unit`
        : `$${proposal.unitPrice.toFixed(2)}`;
  } else if (proposal.type === 'supplierLink') {
    heading = proposal.wouldBecomePreferred
      ? `Set as preferred supplier for ${proposal.productName}`
      : `Link supplier to ${proposal.productName}`;
    detail = proposal.caseSize
      ? `$${proposal.unitCost.toFixed(2)}/unit · $${(proposal.unitCost * proposal.caseSize).toFixed(2)}/case`
      : `$${proposal.unitCost.toFixed(2)}/unit`;
  }

  const decided = decision !== null && decision !== undefined;
  return (
    <View style={S.proposalCard}>
      <Text style={{ color:'#92400e', fontWeight:'700', fontSize:13, marginBottom:2 }}>{heading}</Text>
      {!!detail && <Text style={{ color:'#92400e', fontSize:12, marginBottom:6 }}>{detail}</Text>}
      <View style={S.decisionRow}>
        {!decided ? (
          <>
            <TouchableOpacity
              style={[S.smallBtn, { backgroundColor:'#16a34a' }]}
              onPress={() => onDecide(proposal.id, 'accept')}
            >
              <Text style={S.smallBtnText}>Accept</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[S.smallBtn, { backgroundColor:'#6B7280' }]}
              onPress={() => onDecide(proposal.id, 'skip')}
            >
              <Text style={S.smallBtnText}>Skip</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={{ color: decision === 'accept' ? '#16a34a' : '#6B7280', fontWeight:'700', flex:1, fontSize:13 }}>
              {decision === 'accept' ? '✓ Accepted' : '— Skipped'}
            </Text>
            <TouchableOpacity
              style={[S.smallBtn, { backgroundColor:'#E5E7EB' }]}
              onPress={() => onDecide(proposal.id, decision === 'accept' ? 'skip' : 'accept')}
            >
              <Text style={[S.smallBtnText, { color:'#374151' }]}>Change</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </View>
  );
}

const S = StyleSheet.create({
  header: {
    flexDirection:'row',
    alignItems:'center',
    justifyContent:'space-between',
    padding:12,
    borderBottomWidth:1,
    borderColor:'#E5E7EB'
  },
  back: { fontSize:18, color:'#2563EB', width:60 },
  title: { fontSize:18, fontWeight:'800' },

  block: {
    borderWidth:1,
    borderColor:'#E5E7EB',
    borderRadius:12,
    padding:12,
    backgroundColor:'#F9FAFB'
  },
  blockTitle: { fontWeight:'800', marginBottom:4 },
  kv: { color:'#374151', marginTop:2 },
  v: { fontWeight:'700' },

  lineRow: {
    paddingVertical:6,
    borderBottomWidth:StyleSheet.hairlineWidth,
    borderBottomColor:'#E5E7EB'
  },
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

  warn: {
    color:'#92400e',
    backgroundColor:'#fffbeb',
    paddingVertical:4,
    paddingHorizontal:8,
    borderRadius:8,
    marginTop:4
  },

  footer: {
    padding:16,
    borderTopWidth:1,
    borderTopColor:'#E5E7EB'
  },
  btn: {
    flex:1,
    padding:14,
    borderRadius:12,
    alignItems:'center',
    justifyContent:'center'
  },
  btnText: { color:'#fff', fontWeight:'800' },

  proposalCard: {
    backgroundColor:'#fffbeb',
    borderWidth:1,
    borderColor:'#fcd34d',
    borderRadius:8,
    padding:10,
    marginTop:8,
  },
  decisionRow: {
    flexDirection:'row',
    gap:8,
    marginTop:6,
    alignItems:'center',
  },
  smallBtn: {
    paddingHorizontal:12,
    paddingVertical:6,
    borderRadius:8,
    alignItems:'center',
    justifyContent:'center',
  },
  smallBtnText: {
    color:'#fff',
    fontWeight:'700',
    fontSize:12,
  },
});
