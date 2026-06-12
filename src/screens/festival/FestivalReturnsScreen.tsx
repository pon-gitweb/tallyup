// @ts-nocheck
import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { collection, getDocs, doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useVenueId } from '../../context/VenueProvider';
import { FESTIVAL_BETA } from '../../config/festivalBeta';
import { sendReturnEmail } from '../../services/festival/returnEmail';
import { generatePackingSlipPDF } from '../../services/festival/packingSlip';
import { useColours, useTheme } from '../../context/ThemeContext';
import { useToast } from '../../components/common/Toast';
import { useConfirmModal } from '../../components/common/useConfirmModal';

// ─── Types ────────────────────────────────────────────────────────────────────

type ReturnProduct = {
  productId: string;
  productName: string;
  totalRemaining: number;
  unit: string;
  costPrice: number | null;
  supplierName: string;
  hasPhotos: boolean;
  condition: string;
  casesPerUnit: number;
};

type SupplierGroup = {
  supplierName: string;
  products: ReturnProduct[];
  totalValue: number;
  packingSlipGenerated: boolean;
  emailSent: boolean;
};

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function FestivalReturnsScreen() {
  const nav     = useNavigation<any>();
  const venueId = useVenueId();
  const c = useColours();
  const { theme } = useTheme();
  const { showSuccess, showError, showInfo } = useToast();
  const { confirm, modal } = useConfirmModal();
  const S = makeStyles(c);

  const [event,      setEvent]      = useState<any>(null);
  const [groups,     setGroups]     = useState<SupplierGroup[]>([]);
  const [loading,    setLoading]    = useState(FESTIVAL_BETA);
  const [generating, setGenerating] = useState<string | null>(null);
  const [sending,    setSending]    = useState<string | null>(null);

  useEffect(() => {
    if (!FESTIVAL_BETA || !venueId) { setLoading(false); return; }

    const unsub = onSnapshot(doc(db, 'venues', venueId, 'event', 'details'), async snap => {
      const ev = snap.exists() ? snap.data() : null;
      setEvent(ev);
      await loadReturnsData(ev);
      setLoading(false);
    }, () => setLoading(false));
    return () => unsub();
  }, [venueId]);

  async function loadReturnsData(ev: any) {
    if (!venueId) return;
    try {
      // Load bar counts
      const barCountsSnap = await getDocs(
        collection(db, 'venues', venueId, 'returns', 'eventClose', 'barCounts')
      );

      // Aggregate total remaining per productId
      const totalRemaining: Record<string, { productName: string; totalCount: number; unit: string }> = {};
      for (const bc of barCountsSnap.docs) {
        const data = bc.data() as any;
        for (const c of (data.counts || [])) {
          if (!totalRemaining[c.productId]) {
            totalRemaining[c.productId] = { productName: c.productName, totalCount: 0, unit: c.unit || 'units' };
          }
          totalRemaining[c.productId].totalCount += c.finalCount || 0;
        }
      }

      // Load products for costPrice + supplierName
      const productsSnap = await getDocs(collection(db, 'venues', venueId, 'products'));
      const productMap: Record<string, any> = {};
      productsSnap.docs.forEach(d => { productMap[d.id] = d.data(); });

      // Load photos to check coverage
      let photoProductIds = new Set<string>();
      try {
        const photosSnap = await getDocs(
          collection(db, 'venues', venueId, 'returns', 'eventReturn', 'photos')
        );
        photosSnap.docs.forEach(d => {
          const pd = d.data() as any;
          if (pd.productId) photoProductIds.add(pd.productId);
        });
      } catch {}

      // Group by supplier
      const supplierMap: Record<string, SupplierGroup> = {};

      for (const [productId, rem] of Object.entries(totalRemaining)) {
        if (rem.totalCount <= 0) continue;
        const prod = productMap[productId];
        const supplierName = prod?.supplierName || prod?.primarySupplierName || 'Other / Unknown';
        const costPrice: number | null = prod?.costPrice ?? null;
        // Exclude non-general stock (rider, activation, promo) from return calculations
        const stockCategory = prod?.stockCategory || 'general';
        if (stockCategory !== 'general' && stockCategory !== undefined && stockCategory !== null) continue;

        const rp: ReturnProduct = {
          productId,
          productName: rem.productName,
          totalRemaining: rem.totalCount,
          unit: rem.unit,
          costPrice,
          supplierName,
          hasPhotos: photoProductIds.has(productId),
          condition: 'Sealed',
          casesPerUnit: prod?.casesPerUnit || 12,
        };

        if (!supplierMap[supplierName]) {
          supplierMap[supplierName] = {
            supplierName,
            products: [],
            totalValue: 0,
            packingSlipGenerated: false,
            emailSent: false,
          };
        }
        supplierMap[supplierName].products.push(rp);
        supplierMap[supplierName].totalValue += (costPrice ?? 0) * rem.totalCount;
      }

      setGroups(Object.values(supplierMap));
    } catch (e: any) {
      console.log('[FestivalReturns] load error', e?.message);
    }
  }

  // ── Coming-soon gate ──────────────────────────────────────────────────────
  if (!FESTIVAL_BETA) {
    return (
      <View style={S.center}>
        <Text style={S.csEmoji}>🎪</Text>
        <Text style={S.csTitle}>Festival mode</Text>
        <Text style={S.csBody}>Coming soon — we'll let you know when it's live.</Text>
        <Text style={S.csContact}>Questions? office@hosti.co.nz</Text>
      </View>
    );
  }

  if (loading) return <View style={S.center}><ActivityIndicator color={c.deepBlue} size="large" /></View>;

  async function handleGenerateSlip(group: SupplierGroup) {
    if (!event || generating) return;
    setGenerating(group.supplierName);
    try {
      const supplierCode = group.supplierName.replace(/[^a-zA-Z]/g, '').slice(0, 4).toUpperCase() || 'SUP';
      const eventCode    = (event.eventName || 'EVT').replace(/[^a-zA-Z]/g, '').slice(0, 4).toUpperCase();
      const slipNumber   = `${eventCode}-${supplierCode}-001-P1`;
      const today        = new Date().toLocaleDateString('en-NZ');

      await generatePackingSlipPDF({
        slipNumber,
        eventName:    event.eventName || 'Festival',
        supplierName: group.supplierName,
        palletNumber: 1,
        totalPallets: 1,
        date:         today,
        products:     group.products.map(p => ({
          productName: p.productName,
          quantity:    p.totalRemaining,
          unit:        p.unit,
          casesCount:  Math.ceil(p.totalRemaining / (p.casesPerUnit || 12)),
          condition:   p.condition,
          photoRef:    p.hasPhotos ? 'See return photos' : null,
        })),
        festivalContact: {
          name:  event.contactName || 'Festival Admin',
          phone: event.contactPhone || '',
        },
        chepPallets:       null,
        driverSignatureLine: true,
        notes: null,
      });

      setGroups(prev => prev.map(g =>
        g.supplierName === group.supplierName ? { ...g, packingSlipGenerated: true } : g
      ));
      nav.navigate('FestivalPackingSlip', { supplierName: group.supplierName });
    } catch (e: any) {
      showError(e?.message || 'Could not generate packing slip.');
    } finally {
      setGenerating(null);
    }
  }

  async function doSendEmail(group: SupplierGroup) {
    if (sending) return;
    setSending(group.supplierName);
    try {
      await sendReturnEmail({
        supplierName:    group.supplierName,
        supplierEmail:   group.products[0]?.supplierEmail || '',
        eventName:       event?.eventName || 'Festival',
        eventDate:       event?.startDate || new Date().toLocaleDateString('en-NZ'),
        products:        group.products.map(p => ({
          productName: p.productName,
          quantity:    p.totalRemaining,
          unit:        p.unit,
          condition:   p.condition,
        })),
        packingSlips:    [],
        chepPallets:     null,
        collectionDate:  'TBC — contact us to arrange',
        festivalContact: {
          name:  event?.contactName || 'Festival Admin',
          phone: event?.contactPhone || '',
        },
        adminName: event?.contactName || 'Festival Admin',
      });
      setGroups(prev => prev.map(g =>
        g.supplierName === group.supplierName ? { ...g, emailSent: true } : g
      ));
      showSuccess(`✓ Return email prepared for ${group.supplierName}`);
    } catch (e: any) {
      showError(e?.message || 'Could not prepare email.');
    } finally {
      setSending(null);
    }
  }

  function handleSendEmail(group: SupplierGroup) {
    if (sending) return;
    confirm({
      title: 'Send return email?',
      message: `This will prepare a return email for ${group.supplierName}.`,
      confirmLabel: 'Send email',
      onConfirm: () => doSendEmail(group),
    });
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.oat }}>
      {modal}
      <ScrollView contentContainerStyle={S.scroll}>
        <Text style={S.screenTitle}>Returns</Text>
        {event?.eventName && <Text style={S.sub}>{event.eventName}</Text>}

        {groups.length === 0 ? (
          <View style={S.emptyCard}>
            <Text style={S.emptyText}>No remaining stock found. Complete the end-of-event count first.</Text>
            <TouchableOpacity style={S.secondaryBtn} onPress={() => nav.navigate('FestivalEndOfEventCount')}>
              <Text style={S.secondaryBtnText}>Go to end-of-event count</Text>
            </TouchableOpacity>
          </View>
        ) : (
          groups.map(group => (
            <View key={group.supplierName} style={S.supplierCard}>
              <Text style={S.supplierName}>{group.supplierName}</Text>
              <Text style={S.divider}>━━━━━━━━━━━━━━━━━━━━</Text>

              {group.products.map(p => (
                <View key={p.productId} style={S.productRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={S.productName}>{p.productName}</Text>
                    <Text style={S.productMeta}>
                      Remaining: {p.totalRemaining} {p.unit}
                      {p.costPrice != null ? `  ·  Value: $${(p.costPrice * p.totalRemaining).toFixed(2)}` : ''}
                    </Text>
                    <Text style={[S.photoBadge, p.hasPhotos ? S.photoBadgeOk : S.photoBadgeMissing]}>
                      {p.hasPhotos ? '✓ Photos' : '⏳ No photos yet'}
                    </Text>
                  </View>
                  {!p.hasPhotos && (
                    <TouchableOpacity
                      style={S.addPhotoBtn}
                      onPress={() => nav.navigate('FestivalReturnPhoto', {
                        productId: p.productId,
                        productName: p.productName,
                        remaining: p.totalRemaining,
                      })}
                    >
                      <Text style={S.addPhotoBtnText}>Add photos</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ))}

              {group.totalValue > 0 && (
                <Text style={S.totalValue}>
                  Total return value: ${group.totalValue.toFixed(2)} (at cost)
                </Text>
              )}

              <View style={S.actionRow}>
                <TouchableOpacity
                  style={[S.actionBtn, generating === group.supplierName && S.btnDisabled]}
                  disabled={generating === group.supplierName}
                  onPress={() => handleGenerateSlip(group)}
                >
                  {generating === group.supplierName
                    ? <ActivityIndicator color={c.surface} size="small" />
                    : <Text style={S.actionBtnText}>📄 Packing slip</Text>}
                </TouchableOpacity>
                <TouchableOpacity
                  style={[S.actionBtnSecondary, sending === group.supplierName && S.btnDisabled]}
                  disabled={sending === group.supplierName}
                  onPress={() => handleSendEmail(group)}
                >
                  {sending === group.supplierName
                    ? <ActivityIndicator color={c.deepBlue} size="small" />
                    : <Text style={S.actionBtnSecondaryText}>✉️ Return email</Text>}
                </TouchableOpacity>
              </View>

              {(group.packingSlipGenerated || group.emailSent) && (
                <View style={S.statusRow}>
                  {group.packingSlipGenerated && <Text style={S.statusBadge}>✓ Slip generated</Text>}
                  {group.emailSent && <Text style={S.statusBadge}>✓ Email sent</Text>}
                </View>
              )}
            </View>
          ))
        )}

        <TouchableOpacity
          style={[S.primaryBtn, { marginTop: 24 }]}
          onPress={() => nav.navigate('FestivalReconciliation')}
        >
          <Text style={S.primaryBtnText}>Proceed to reconciliation →</Text>
        </TouchableOpacity>

      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
function makeStyles(c: any) {
  return StyleSheet.create({
    center:     { flex: 1, backgroundColor: c.oat, alignItems: 'center', justifyContent: 'center', padding: 36 },
    csEmoji:    { fontSize: 52, marginBottom: 20, textAlign: 'center' },
    csTitle:    { fontSize: 22, fontWeight: '800', color: c.navy, textAlign: 'center', marginBottom: 12 },
    csBody:     { fontSize: 16, color: c.slateMid, textAlign: 'center', lineHeight: 24 },
    csContact:  { marginTop: 20, fontSize: 14, color: c.slateMid, textAlign: 'center' },

    scroll:         { padding: 16, paddingBottom: 40 },
    screenTitle:    { fontSize: 22, fontWeight: '800', color: c.navy, marginBottom: 4 },
    sub:            { fontSize: 14, color: c.slateMid, marginBottom: 20 },

    supplierCard:   { backgroundColor: c.surface, borderRadius: 14, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: c.border },
    supplierName:   { fontSize: 17, fontWeight: '800', color: c.navy, marginBottom: 4 },
    divider:        { fontSize: 10, color: c.border, marginBottom: 10, letterSpacing: 2 },

    productRow:     { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: c.border },
    productName:    { fontSize: 14, fontWeight: '600', color: c.navy, marginBottom: 2 },
    productMeta:    { fontSize: 12, color: c.slateMid, marginBottom: 3 },
    photoBadge:     { fontSize: 11, fontWeight: '700' },
    photoBadgeOk:   { color: c.success },
    photoBadgeMissing:{ color: c.stellarAmber },
    addPhotoBtn:    { backgroundColor: c.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
    addPhotoBtnText:{ fontSize: 12, color: c.deepBlue, fontWeight: '700' },

    totalValue:     { fontSize: 14, fontWeight: '700', color: c.navy, marginTop: 10, marginBottom: 10 },

    actionRow:          { flexDirection: 'row', gap: 10, marginTop: 12 },
    actionBtn:          { flex: 1, backgroundColor: c.deepBlue, borderRadius: 999, paddingVertical: 11, alignItems: 'center' },
    actionBtnText:      { color: c.surface, fontWeight: '700', fontSize: 13 },
    actionBtnSecondary: { flex: 1, borderWidth: 1.5, borderColor: c.deepBlue, borderRadius: 999, paddingVertical: 11, alignItems: 'center' },
    actionBtnSecondaryText:{ color: c.deepBlue, fontWeight: '700', fontSize: 13 },

    statusRow:  { flexDirection: 'row', gap: 8, marginTop: 8 },
    statusBadge:{ fontSize: 11, fontWeight: '700', color: c.success },

    emptyCard:  { backgroundColor: c.surface, borderRadius: 12, padding: 24, alignItems: 'center', borderWidth: 1, borderColor: c.border, marginBottom: 12 },
    emptyText:  { fontSize: 14, color: c.slateMid, textAlign: 'center', marginBottom: 12 },

    primaryBtn:      { backgroundColor: c.deepBlue, borderRadius: 999, paddingVertical: 15, alignItems: 'center' },
    primaryBtnText:  { color: c.surface, fontWeight: '700', fontSize: 15 },
    secondaryBtn:    { borderWidth: 1.5, borderColor: c.deepBlue, borderRadius: 999, paddingVertical: 13, alignItems: 'center', marginTop: 8 },
    secondaryBtnText:{ color: c.deepBlue, fontWeight: '700', fontSize: 14 },
    btnDisabled:     { opacity: 0.5 },
  });
}
