// @ts-nocheck
import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  ScrollView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { ref, uploadString, getDownloadURL } from 'firebase/storage';
import { collection, doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { db, auth, storage } from '../../services/firebase';
import { useVenue } from '../../context/VenueProvider';
import { FESTIVAL_BETA } from '../../config/festivalBeta';
import { apiBase } from '../../services/apiBase';
import { useColours, useTheme } from '../../context/ThemeContext';
import { useToast } from '../../components/common/Toast';
import { useConfirmModal } from '../../components/common/useConfirmModal';

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function FestivalContractScreen() {
  const nav      = useNavigation<any>();
  const { venueId, user } = useVenue();
  const uid      = user?.uid;
  const c = useColours();
  const { theme } = useTheme();
  const { showSuccess, showError, showInfo } = useToast();
  const { confirm, modal } = useConfirmModal();
  const C = makeStyles(c);

  const [role,       setRole]       = useState<string | null>(null);
  const [contracts,  setContracts]  = useState<any[]>([]);
  const [loading,    setLoading]    = useState(FESTIVAL_BETA);
  const [uploading,  setUploading]  = useState(false);
  const [pendingFile, setPendingFile] = useState<{ name: string; uri: string } | null>(null);

  // Load role
  useEffect(() => {
    if (!FESTIVAL_BETA || !venueId || !uid) { setLoading(false); return; }
    const unsub = onSnapshot(doc(db, 'venues', venueId, 'members', uid), snap => {
      setRole(snap.exists() ? (snap.data() as any)?.role ?? null : null);
      setLoading(false);
    });
    return () => unsub();
  }, [venueId, uid]);

  // Live contracts listener (only loads if owner)
  useEffect(() => {
    if (!FESTIVAL_BETA || !venueId || role !== 'owner') return;
    const unsub = onSnapshot(
      collection(db, 'venues', venueId, 'contracts'),
      snap => setContracts(snap.docs
        .map(d => ({ id: d.id, ...(d.data() as any) }))
        .sort((a, b) => (b.uploadedAt?.toDate?.()?.getTime() ?? 0) - (a.uploadedAt?.toDate?.()?.getTime() ?? 0))
      ),
      () => {},
    );
    return () => unsub();
  }, [venueId, role]);

  // ── Coming-soon gate ──────────────────────────────────────────────────────
  if (!FESTIVAL_BETA) {
    return (
      <View style={C.comingSoon}>
        <Text style={C.csEmoji}>🎪</Text>
        <Text style={C.csTitle}>Festival mode</Text>
        <Text style={C.csBody}>
          We're building something great for festival and event operators.{'\n'}
          Coming soon — we'll let you know when it's live.
        </Text>
        <Text style={C.csContact}>Questions? office@hosti.co.nz</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={C.comingSoon}>
        <ActivityIndicator color={c.deepBlue} size="large" />
      </View>
    );
  }

  if (role !== 'owner') {
    return (
      <View style={C.comingSoon}>
        <Text style={C.csEmoji}>🔒</Text>
        <Text style={C.csTitle}>Owner only</Text>
        <Text style={C.csBody}>Contracts are confidential and visible to the venue owner only.</Text>
      </View>
    );
  }

  async function pickDocument() {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      setPendingFile({ name: asset.name, uri: asset.uri });
    } catch {
      showError('Could not open document picker.');
    }
  }

  async function confirmUpload() {
    if (!pendingFile) return;
    if (!venueId || !uid) {
      showError('Authentication error — please try again.');
      return;
    }
    setUploading(true);
    try {
      // 1. Read as base64 — copy to local cache first, since Android
      // content:// URIs can fail with FileSystem.readAsStringAsync
      let base64: string;
      try {
        const localUri = FileSystem.cacheDirectory + (pendingFile.name.replace(/[^a-zA-Z0-9._-]/g, '_'));
        await FileSystem.copyAsync({ from: pendingFile.uri, to: localUri });
        base64 = await FileSystem.readAsStringAsync(localUri, { encoding: FileSystem.EncodingType.Base64 });
        FileSystem.deleteAsync(localUri, { idempotent: true }).catch(() => {});
      } catch (readError: any) {
        showError('Could not read this PDF. Please try a different file or export it as a standard PDF.');
        setUploading(false);
        return;
      }
      const dataUrl = `data:application/pdf;base64,${base64}`;

      // 2. Upload to Firebase Storage
      const storagePath = `festival-contracts/${venueId}/details/${Date.now()}_${pendingFile.name}`;
      const storageRef = ref(storage, storagePath);
      await uploadString(storageRef, dataUrl, 'data_url');

      // 3. Write contract doc
      const contractId = `contract_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      await setDoc(doc(db, 'venues', venueId, 'contracts', contractId), {
        supplierName:          null,
        fileName:              pendingFile.name,
        storageRef:            storagePath,
        status:                'processing',
        uploadedBy:            uid,
        uploadedAt:            serverTimestamp(),
        extractedObligations:  [],
        rawExtraction:         null,
      });

      setPendingFile(null);

      // 4. Call Cloud Function
      const token = await auth.currentUser?.getIdToken();
      console.log('[contract-upload] calling extract-festival-contract', { venueId, contractId, hasToken: !!token });
      const resp = await fetch(`${apiBase()}/extract-festival-contract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ venueId, contractId, storageRef: storagePath }),
      });
      const json = await resp.json().catch(() => null);

      if (!resp.ok || !json?.ok) {
        showError(
          json?.scanned
            ? 'This PDF appears to be a scanned image. Please upload a digital PDF.'
            : 'Extraction could not be completed automatically. Review the contract manually.',
        );
      }
    } catch (e: any) {
      showError(e?.message || 'Please try again.');
    } finally {
      setUploading(false);
    }
  }

  function statusBadge(contract: any): { icon: string; label: string; color: string } {
    if (contract.status === 'extracted')    return { icon: '✓', label: 'Extracted',     color: c.success };
    if (contract.status === 'processing')   return { icon: '⏳', label: 'Processing',   color: c.stellarAmber };
    if (contract.status === 'review_needed')return { icon: '⚠️', label: 'Review needed', color: c.error };
    return { icon: '📄', label: contract.status ?? 'Unknown', color: c.slateMid };
  }

  function formatDate(ts: any): string {
    if (!ts?.toDate) return '';
    const d = ts.toDate();
    return d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.oat }}>
      {modal}
      <ScrollView contentContainerStyle={C.scroll}>

        <Text style={C.screenTitle}>Contracts</Text>
        <Text style={C.screenSub}>Owner only — confidential</Text>

        {/* Pending file confirm */}
        {pendingFile && (
          <View style={C.pendingCard}>
            <Text style={C.pendingName}>📄 {pendingFile.name}</Text>
            <Text style={C.pendingHint}>Upload this contract and extract obligations?</Text>
            <View style={C.pendingActions}>
              <TouchableOpacity
                style={[C.confirmBtn, uploading && C.btnDisabled]}
                onPress={confirmUpload}
                disabled={uploading}
              >
                {uploading
                  ? <ActivityIndicator color={c.primaryText} size="small" />
                  : <Text style={C.confirmBtnText}>Confirm upload</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={C.discardBtn} onPress={() => setPendingFile(null)} disabled={uploading}>
                <Text style={C.discardBtnText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Upload button */}
        {!pendingFile && (
          <TouchableOpacity style={C.uploadBtn} onPress={pickDocument}>
            <Text style={C.uploadBtnText}>+ Upload new contract</Text>
          </TouchableOpacity>
        )}

        {/* Contract list */}
        {contracts.length === 0 ? (
          <View style={C.emptyCard}>
            <Text style={C.emptyText}>No contracts uploaded yet.</Text>
            <Text style={C.emptyHint}>Upload supplier contracts to automatically extract obligations and rebate thresholds.</Text>
          </View>
        ) : (
          contracts.map(contract => {
            const badge = statusBadge(contract);
            const oblCount = contract.extractedObligations?.length ?? 0;
            return (
              <View key={contract.id} style={C.card}>
                <View style={C.cardTop}>
                  <Text style={C.cardSupplier} numberOfLines={1}>
                    {contract.supplierName || contract.fileName || 'Unknown supplier'}
                  </Text>
                  <View style={[C.badge, { borderColor: badge.color }]}>
                    <Text style={[C.badgeText, { color: badge.color }]}>{badge.icon} {badge.label}</Text>
                  </View>
                </View>
                <Text style={C.cardDate}>Uploaded: {formatDate(contract.uploadedAt)}</Text>
                <Text style={C.cardFile} numberOfLines={1}>📄 {contract.fileName}</Text>
                {oblCount > 0 && (
                  <Text style={C.oblCount}>Obligations extracted: {oblCount}</Text>
                )}
                {contract.reviewNote && (
                  <Text style={C.reviewNote}>{contract.reviewNote}</Text>
                )}
                {oblCount > 0 && (
                  <TouchableOpacity
                    style={C.viewObligationsBtn}
                    onPress={() => nav.navigate('FestivalObligations')}
                  >
                    <Text style={C.viewObligationsBtnText}>View obligations →</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          })
        )}

      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
function makeStyles(c: any) {
  return StyleSheet.create({
    comingSoon: { flex: 1, backgroundColor: c.oat, alignItems: 'center', justifyContent: 'center', padding: 36 },
    csEmoji:    { fontSize: 52, marginBottom: 20, textAlign: 'center' },
    csTitle:    { fontSize: 26, fontWeight: '800', color: c.navy, textAlign: 'center', marginBottom: 16 },
    csBody:     { fontSize: 16, color: c.slateMid, textAlign: 'center', lineHeight: 24, marginBottom: 12 },
    csContact:  { marginTop: 20, fontSize: 14, color: c.slateMid, textAlign: 'center', lineHeight: 22 },

    scroll:       { padding: 16, paddingBottom: 40 },
    screenTitle:  { fontSize: 22, fontWeight: '800', color: c.navy, marginBottom: 2 },
    screenSub:    { fontSize: 12, color: c.slateMid, marginBottom: 16 },

    uploadBtn:     { backgroundColor: c.deepBlue, borderRadius: 999, paddingVertical: 14, alignItems: 'center', marginBottom: 16 },
    uploadBtnText: { color: c.primaryText, fontWeight: '700', fontSize: 15 },

    pendingCard:    { backgroundColor: c.surface, borderRadius: 14, padding: 16, marginBottom: 16, borderWidth: 1.5, borderColor: c.deepBlue },
    pendingName:    { fontSize: 14, fontWeight: '700', color: c.navy, marginBottom: 4 },
    pendingHint:    { fontSize: 13, color: c.text, marginBottom: 12 },
    pendingActions: { flexDirection: 'row', gap: 10 },
    confirmBtn:     { flex: 1, backgroundColor: c.deepBlue, borderRadius: 999, paddingVertical: 12, alignItems: 'center' },
    confirmBtnText: { color: c.primaryText, fontWeight: '700', fontSize: 14 },
    discardBtn:     { paddingHorizontal: 20, borderWidth: 1.5, borderColor: c.border, borderRadius: 999, paddingVertical: 12, alignItems: 'center' },
    discardBtnText: { color: c.slateMid, fontWeight: '700', fontSize: 14 },
    btnDisabled:    { opacity: 0.5 },

    card:        { backgroundColor: c.surface, borderRadius: 14, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: c.border },
    cardTop:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
    cardSupplier:{ fontSize: 16, fontWeight: '800', color: c.navy, flex: 1, marginRight: 8 },
    badge:       { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1 },
    badgeText:   { fontSize: 11, fontWeight: '700' },
    cardDate:    { fontSize: 12, color: c.slateMid, marginBottom: 2 },
    cardFile:    { fontSize: 12, color: c.slateMid, marginBottom: 6 },
    oblCount:    { fontSize: 13, fontWeight: '600', color: c.deepBlue, marginBottom: 4 },
    reviewNote:  { fontSize: 12, color: c.stellarAmber, marginBottom: 6 },
    viewObligationsBtn: { alignSelf: 'flex-start' },
    viewObligationsBtnText: { fontSize: 13, color: c.deepBlue, fontWeight: '700' },

    emptyCard: { backgroundColor: c.surface, borderRadius: 12, padding: 24, alignItems: 'center', borderWidth: 1, borderColor: c.border },
    emptyText: { fontSize: 15, fontWeight: '700', color: c.navy, marginBottom: 6 },
    emptyHint: { fontSize: 13, color: c.slateMid, textAlign: 'center', lineHeight: 18 },
  });
}
