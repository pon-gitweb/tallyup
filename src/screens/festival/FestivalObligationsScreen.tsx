// @ts-nocheck
import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  ScrollView, Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { collection, doc, onSnapshot, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../../services/firebase';
import { useVenueId } from '../../context/VenueProvider';
import { FESTIVAL_BETA } from '../../config/festivalBeta';
import { calculateObligationProgress, type ObligationProgress } from '../../services/festival/obligationTracker';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusConfig(s: string): { color: string; icon: string; label: string } {
  if (s === 'met')         return { color: '#16a34a', icon: '✓',  label: 'Met' };
  if (s === 'on_track')    return { color: '#1b4f72', icon: '→',  label: 'On track' };
  if (s === 'at_risk')     return { color: '#d97706', icon: '⚠️', label: 'At risk' };
  if (s === 'missed')      return { color: '#dc2626', icon: '✗',  label: 'Missed' };
  return                          { color: '#9ca3af', icon: '○',  label: 'Not started' };
}

// ─── Progress bar ─────────────────────────────────────────────────────────────

function ProgressBar({ pct, color }: { pct: number; color: string }) {
  return (
    <View style={OB.progressBg}>
      <View style={[OB.progressFill, { width: `${Math.max(2, pct)}%`, backgroundColor: color }]} />
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function FestivalObligationsScreen() {
  const nav     = useNavigation<any>();
  const venueId = useVenueId();
  const uid     = auth.currentUser?.uid;

  const [role,        setRole]        = useState<string | null>(null);
  const [obligations, setObligations] = useState<any[]>([]);
  const [progress,    setProgress]    = useState<Record<string, ObligationProgress>>({});
  const [contracts,   setContracts]   = useState<any[]>([]);  // owner only
  const [event,       setEvent]       = useState<any>(null);
  const [loading,     setLoading]     = useState(FESTIVAL_BETA);
  const [confirming,  setConfirming]  = useState<string | null>(null);

  // Load role
  useEffect(() => {
    if (!FESTIVAL_BETA || !venueId || !uid) { setLoading(false); return; }
    const unsub = onSnapshot(doc(db, 'venues', venueId, 'members', uid), snap => {
      setRole(snap.exists() ? (snap.data() as any)?.role ?? null : null);
    });
    return () => unsub();
  }, [venueId, uid]);

  // Load event (for hours remaining)
  useEffect(() => {
    if (!FESTIVAL_BETA || !venueId) return;
    const unsub = onSnapshot(doc(db, 'venues', venueId, 'event', 'details'), snap => {
      setEvent(snap.exists() ? snap.data() : null);
      setLoading(false);
    }, () => setLoading(false));
    return () => unsub();
  }, [venueId]);

  // Load obligations (manager + owner)
  useEffect(() => {
    if (!FESTIVAL_BETA || !venueId || !role) return;
    if (role !== 'owner' && role !== 'manager') return;

    const unsub = onSnapshot(
      collection(db, 'venues', venueId, 'obligations'),
      snap => {
        const obls = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
        setObligations(obls);
        // Calculate progress for each obligation
        const hrs = hoursRemainingInEvent(event);
        obls.forEach(async obl => {
          try {
            const p = await calculateObligationProgress(venueId, { ...obl, id: obl.id }, hrs);
            setProgress(prev => ({ ...prev, [obl.id]: p }));
          } catch {}
        });
      },
      () => {},
    );
    return () => unsub();
  }, [venueId, role, event]);

  // Load contracts (owner only — for rebates section)
  useEffect(() => {
    if (!FESTIVAL_BETA || !venueId || role !== 'owner') return;
    const unsub = onSnapshot(
      collection(db, 'venues', venueId, 'contracts'),
      snap => setContracts(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })).filter(c => c.status === 'extracted')),
      () => {},
    );
    return () => unsub();
  }, [venueId, role]);

  function hoursRemainingInEvent(evt: any): number | null {
    if (!evt?.endDate) return null;
    const parts = evt.endDate.split('/');
    if (parts.length !== 3) return null;
    const end = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]), 23, 59);
    const hrs = (end.getTime() - Date.now()) / 3_600_000;
    return hrs > 0 ? hrs : 0;
  }

  async function confirmDisplayRequirement(obligationId: string) {
    if (!venueId || confirming) return;
    setConfirming(obligationId);
    try {
      await updateDoc(doc(db, 'venues', venueId, 'obligations', obligationId), {
        currentProgress: 1,
        status:          'met',
        confirmedBy:     uid,
        confirmedAt:     serverTimestamp(),
        updatedAt:       serverTimestamp(),
      });
    } catch (e: any) {
      Alert.alert('Error', e?.message);
    } finally {
      setConfirming(null);
    }
  }

  // ── Coming-soon gate ──────────────────────────────────────────────────────
  if (!FESTIVAL_BETA) {
    return (
      <View style={OB.comingSoon}>
        <Text style={OB.csEmoji}>🎪</Text>
        <Text style={OB.csTitle}>Festival mode</Text>
        <Text style={OB.csBody}>
          We're building something great for festival and event operators.{'\n'}
          Coming soon — we'll let you know when it's live.
        </Text>
        <Text style={OB.csContact}>Questions? office@hosti.co.nz</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={OB.comingSoon}>
        <ActivityIndicator color="#1b4f72" size="large" />
      </View>
    );
  }

  if (role !== 'owner' && role !== 'manager') {
    return (
      <View style={OB.comingSoon}>
        <Text style={OB.csEmoji}>🔒</Text>
        <Text style={OB.csTitle}>Manager access required</Text>
        <Text style={OB.csBody}>Obligation tracking is visible to managers and owners.</Text>
      </View>
    );
  }

  // Group obligations by supplier
  const bySupplier: Record<string, any[]> = {};
  for (const obl of obligations) {
    const key = obl.supplierName || 'Unknown Supplier';
    if (!bySupplier[key]) bySupplier[key] = [];
    bySupplier[key].push(obl);
  }

  // Build rebate data (owner only — never expose $ to manager)
  const rebatesBySupplier: Record<string, any[]> = {};
  if (role === 'owner') {
    for (const contract of contracts) {
      if (!contract.rebates?.length) continue;
      const key = contract.supplierName || 'Unknown Supplier';
      if (!rebatesBySupplier[key]) rebatesBySupplier[key] = [];
      rebatesBySupplier[key].push(...contract.rebates);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#f5f3ee' }}>
      <ScrollView contentContainerStyle={OB.scroll}>

        <Text style={OB.screenTitle}>Sponsor obligations</Text>
        {event?.eventName ? <Text style={OB.eventName}>{event.eventName}</Text> : null}

        {obligations.length === 0 && (
          <View style={OB.emptyCard}>
            <Text style={OB.emptyText}>No obligations found.</Text>
            <Text style={OB.emptyHint}>
              {role === 'owner'
                ? 'Upload supplier contracts to automatically extract obligations.'
                : 'No obligations have been extracted from contracts yet.'}
            </Text>
            {role === 'owner' && (
              <TouchableOpacity style={OB.emptyBtn} onPress={() => nav.navigate('FestivalContracts')}>
                <Text style={OB.emptyBtnText}>View contracts →</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {Object.entries(bySupplier).map(([supplierName, obls]) => (
          <View key={supplierName} style={OB.supplierSection}>
            <Text style={OB.supplierName}>{supplierName}</Text>
            <View style={OB.divider} />

            {obls.map(obl => {
              const prog = progress[obl.id];
              const sc = statusConfig(prog?.status ?? obl.status ?? 'not_started');
              const isDisplay = obl.type === 'display_requirement';
              const isConfirming = confirming === obl.id;

              return (
                <View key={obl.id} style={OB.oblCard}>
                  <View style={OB.oblHeader}>
                    <Text style={OB.oblType}>{formatType(obl.type)}{obl.product ? ` — ${obl.product}` : ''}</Text>
                    <View style={[OB.statusBadge, { borderColor: sc.color }]}>
                      <Text style={[OB.statusText, { color: sc.color }]}>{sc.icon} {sc.label}</Text>
                    </View>
                  </View>
                  <Text style={OB.requirement}>{obl.requirement}</Text>

                  {/* Progress for minimum_volume */}
                  {obl.type === 'minimum_volume' && prog?.target != null && (
                    <View style={OB.progressSection}>
                      <View style={OB.progressRow}>
                        <Text style={OB.progressLabel}>
                          Target: {prog.target} {obl.unit ?? 'units'}
                        </Text>
                        <Text style={[OB.progressLabel, { fontWeight: '700', color: sc.color }]}>
                          {prog.currentProgress} ({prog.progressPercent}%)
                        </Text>
                      </View>
                      <ProgressBar pct={prog.progressPercent} color={sc.color} />
                      {prog.projectedAtClose != null && (
                        <Text style={OB.projectedText}>
                          Projected at close: ~{prog.projectedAtClose} {obl.unit ?? 'units'}
                        </Text>
                      )}
                    </View>
                  )}

                  {/* Display requirement confirm button */}
                  {isDisplay && (prog?.status === 'not_started' || obl.status === 'not_started') && (
                    <TouchableOpacity
                      style={[OB.confirmBtn, isConfirming && OB.btnDisabled]}
                      disabled={!!confirming}
                      onPress={() => confirmDisplayRequirement(obl.id)}
                    >
                      {isConfirming
                        ? <ActivityIndicator color="#fff" size="small" />
                        : <Text style={OB.confirmBtnText}>Mark as confirmed</Text>}
                    </TouchableOpacity>
                  )}

                  {/* Recommendation */}
                  {prog?.recommendation && (
                    <Text style={[OB.recommendation, { color: sc.color === '#16a34a' ? '#6b7280' : sc.color }]}>
                      {prog.recommendation}
                    </Text>
                  )}
                </View>
              );
            })}

            {/* Rebate section — owner only with $ amounts */}
            {role === 'owner' && rebatesBySupplier[supplierName]?.length > 0 && (
              <View style={OB.rebateCard}>
                <Text style={OB.rebateTitle}>Rebate thresholds</Text>
                {rebatesBySupplier[supplierName].map((rb, i) => (
                  <Text key={i} style={OB.rebateRow}>
                    {rb.product ? `${rb.product}: ` : ''}
                    Spend {rb.thresholdUnit}{rb.threshold.toLocaleString()} for{' '}
                    {rb.rebatePercent != null ? `${rb.rebatePercent}% rebate` : rb.rebateAmount != null ? `$${rb.rebateAmount} rebate` : 'rebate'}
                  </Text>
                ))}
              </View>
            )}
            {role === 'manager' && (rebatesBySupplier[supplierName] ?? []).length === 0 && (
              // Manager sees on-track message without $ amounts
              <View style={OB.rebateCardMgr}>
                <Text style={OB.rebateRowMgr}>Rebate threshold: contact owner for details</Text>
              </View>
            )}
          </View>
        ))}

      </ScrollView>
    </View>
  );
}

function formatType(t: string): string {
  switch (t) {
    case 'minimum_volume':    return 'Minimum volume';
    case 'exclusivity':       return 'Exclusivity';
    case 'display_requirement':return 'Display requirement';
    case 'activation':        return 'Activation';
    case 'rebate':            return 'Rebate';
    case 'return_policy':     return 'Return policy';
    default:                  return t?.replace(/_/g, ' ') ?? 'Other';
  }
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const OB = StyleSheet.create({
  comingSoon: { flex: 1, backgroundColor: '#f5f3ee', alignItems: 'center', justifyContent: 'center', padding: 36 },
  csEmoji:    { fontSize: 52, marginBottom: 20, textAlign: 'center' },
  csTitle:    { fontSize: 26, fontWeight: '800', color: '#0B132B', textAlign: 'center', marginBottom: 16 },
  csBody:     { fontSize: 16, color: '#6b7280', textAlign: 'center', lineHeight: 24, marginBottom: 12 },
  csContact:  { marginTop: 20, fontSize: 14, color: '#9ca3af', textAlign: 'center', lineHeight: 22 },

  scroll:      { padding: 16, paddingBottom: 40 },
  screenTitle: { fontSize: 22, fontWeight: '800', color: '#0B132B', marginBottom: 4 },
  eventName:   { fontSize: 14, color: '#6b7280', marginBottom: 16 },

  supplierSection: { marginBottom: 20 },
  supplierName:    { fontSize: 17, fontWeight: '800', color: '#0B132B', marginBottom: 8 },
  divider:         { height: 2, backgroundColor: '#e5e1d8', marginBottom: 10, borderRadius: 1 },

  oblCard:   { backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#e5e1d8' },
  oblHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  oblType:   { fontSize: 13, fontWeight: '800', color: '#0B132B', flex: 1, marginRight: 8 },
  statusBadge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1 },
  statusText:  { fontSize: 11, fontWeight: '700' },
  requirement: { fontSize: 13, color: '#374151', lineHeight: 19, marginBottom: 8 },

  progressSection: { marginTop: 4, marginBottom: 8 },
  progressRow:     { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  progressLabel:   { fontSize: 12, color: '#6b7280' },
  progressBg:      { height: 8, backgroundColor: '#e5e7eb', borderRadius: 4, overflow: 'hidden', marginBottom: 4 },
  progressFill:    { height: 8, borderRadius: 4 },
  projectedText:   { fontSize: 11, color: '#9ca3af', marginTop: 2 },

  confirmBtn:     { backgroundColor: '#1b4f72', borderRadius: 999, paddingVertical: 10, alignItems: 'center', marginTop: 8 },
  confirmBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  btnDisabled:    { opacity: 0.5 },

  recommendation: { fontSize: 12, fontStyle: 'italic', marginTop: 4, lineHeight: 17 },

  rebateCard:   { backgroundColor: '#eff6ff', borderRadius: 12, padding: 12, marginTop: 6, borderWidth: 1, borderColor: '#bfdbfe' },
  rebateCardMgr:{ backgroundColor: '#f9fafb', borderRadius: 12, padding: 12, marginTop: 6, borderWidth: 1, borderColor: '#e5e7eb' },
  rebateTitle:  { fontSize: 12, fontWeight: '800', color: '#1b4f72', marginBottom: 6 },
  rebateRow:    { fontSize: 13, color: '#1e40af', lineHeight: 20 },
  rebateRowMgr: { fontSize: 12, color: '#9ca3af', fontStyle: 'italic' },

  emptyCard: { backgroundColor: '#fff', borderRadius: 12, padding: 24, alignItems: 'center', borderWidth: 1, borderColor: '#e5e1d8' },
  emptyText: { fontSize: 15, fontWeight: '700', color: '#0B132B', marginBottom: 6 },
  emptyHint: { fontSize: 13, color: '#9ca3af', textAlign: 'center', lineHeight: 18, marginBottom: 12 },
  emptyBtn:     { borderWidth: 1.5, borderColor: '#1b4f72', borderRadius: 999, paddingVertical: 10, paddingHorizontal: 20 },
  emptyBtnText: { color: '#1b4f72', fontWeight: '700', fontSize: 13 },
});
