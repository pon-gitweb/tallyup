// @ts-nocheck
import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  ScrollView, Share,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useVenueId } from '../../context/VenueProvider';
import { FESTIVAL_BETA } from '../../config/festivalBeta';
import { generatePlanogram, type FridgePlanogram, type PlanogramShelf } from '../../services/festival/fridgePlanogram';
import { calculateFestivalVelocity, type FestivalVelocityData } from '../../services/festival/festivalVelocity';

// ─── Shelf visual ─────────────────────────────────────────────────────────────

const SHELF_COLORS: Record<string, string> = {
  top:    '#eff6ff',
  middle: '#ecfdf5',
  bottom: '#f0f9ff',
  door:   '#faf5ff',
};

function ShelfRow({
  shelf,
  onPositionPress,
  selectedSlot,
}: {
  shelf: PlanogramShelf;
  onPositionPress: (slot: number) => void;
  selectedSlot: number | null;
}) {
  return (
    <View style={P.shelfContainer}>
      <Text style={P.shelfLabel}>{shelf.label}</Text>
      <Text style={P.shelfTemp}>{shelf.tempRangeC.min}–{shelf.tempRangeC.max}°C</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={[P.shelfRow, { backgroundColor: SHELF_COLORS[shelf.id] ?? '#f9fafb' }]}>
          {shelf.positions.map(pos => {
            const isSelected = selectedSlot === pos.slot && pos.productId !== '';
            return (
              <TouchableOpacity
                key={pos.slot}
                style={[P.shelfCell, isSelected && P.shelfCellSelected, pos.supplierRequirement ? P.shelfCellContractual : null]}
                onPress={() => onPositionPress(pos.slot)}
              >
                <Text style={[P.shelfCellText, isSelected && P.shelfCellTextSelected]} numberOfLines={2}>
                  {pos.productName}
                </Text>
                <Text style={[P.shelfCellFacings, isSelected && { color: '#fff' }]}>
                  {pos.facings}F
                </Text>
                {pos.supplierRequirement && (
                  <View style={P.contractualDot} />
                )}
              </TouchableOpacity>
            );
          })}
          {shelf.positions.length === 0 && (
            <View style={P.shelfEmpty}>
              <Text style={P.shelfEmptyText}>Empty</Text>
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function FestivalPlanogramScreen() {
  const nav     = useNavigation<any>();
  const route   = useRoute<any>();
  const venueId = useVenueId();
  const { barId, barName } = route.params || {};

  const [planogram,     setPlanogram]     = useState<FridgePlanogram | null>(null);
  const [selectedSlot,  setSelectedSlot]  = useState<number | null>(null);
  const [selectedShelfId, setSelectedShelfId] = useState<string | null>(null);
  const [loading,       setLoading]       = useState(FESTIVAL_BETA);

  useEffect(() => {
    if (!FESTIVAL_BETA || !venueId || !barId) { setLoading(false); return; }
    buildPlanogram();
  }, [venueId, barId]);

  async function buildPlanogram() {
    try {
      const stockSnap = await getDocs(collection(db, 'venues', venueId, 'bars', barId, 'stock'));
      const products = stockSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));

      // Fetch velocity for each product
      const velocityData: Record<string, FestivalVelocityData> = {};
      await Promise.all(products.map(async p => {
        try {
          velocityData[p.id] = await calculateFestivalVelocity(venueId, barId, p.id, p.currentStock ?? 0, null, undefined, p.productName);
        } catch {}
      }));

      const result = generatePlanogram(
        { id: barId, name: barName || barId },
        products.map(p => ({
          id:                  p.id,
          productName:         p.productName || p.id,
          currentStock:        p.currentStock ?? 0,
          unit:                p.unit,
          supplierRequirement: p.supplierRequirement,
          brand:               p.brand,
        })),
        velocityData,
      );
      setPlanogram(result);
    } catch {
      setPlanogram(null);
    } finally {
      setLoading(false);
    }
  }

  function getSelectedPosition() {
    if (selectedSlot == null || !selectedShelfId || !planogram) return null;
    const shelf = planogram.shelves.find(s => s.id === selectedShelfId);
    return shelf?.positions.find(p => p.slot === selectedSlot) ?? null;
  }

  async function sharePlanogram() {
    if (!planogram) return;
    const lines: string[] = [`FRIDGE PLANOGRAM — ${barName || 'Bar'}`, ''];
    for (const shelf of planogram.shelves) {
      lines.push(`${shelf.label.toUpperCase()}:`);
      for (const pos of shelf.positions) {
        lines.push(`  ${pos.slot}. ${pos.productName} × ${pos.facings} facings — ${pos.reason}`);
        if (pos.supplierRequirement) lines.push(`     ⚠️ Supplier: ${pos.supplierRequirement}`);
      }
      lines.push('');
    }
    if (planogram.requirementChecks.length > 0) {
      lines.push('SUPPLIER REQUIREMENTS:');
      for (const rc of planogram.requirementChecks) {
        lines.push(`  ${rc.met ? '✓' : '⚠️'} ${rc.productName}: ${rc.required}`);
      }
    }
    try {
      await Share.share({ message: lines.join('\n'), title: 'Fridge Planogram' });
    } catch {}
  }

  // ── Coming-soon gate ──────────────────────────────────────────────────────
  if (!FESTIVAL_BETA) {
    return (
      <View style={P.comingSoon}>
        <Text style={P.csEmoji}>🎪</Text>
        <Text style={P.csTitle}>Festival mode</Text>
        <Text style={P.csBody}>
          We're building something great for festival and event operators.{'\n'}
          Coming soon — we'll let you know when it's live.
        </Text>
        <Text style={P.csContact}>Questions? office@hosti.co.nz</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={P.comingSoon}>
        <ActivityIndicator color="#1b4f72" size="large" />
      </View>
    );
  }

  const selectedPos = getSelectedPosition();

  return (
    <View style={{ flex: 1, backgroundColor: '#f5f3ee' }}>
      <ScrollView contentContainerStyle={P.scroll}>

        <Text style={P.screenTitle}>{barName} — Fridge Planogram</Text>

        {/* Legend */}
        <View style={P.legendRow}>
          <View style={P.legendItem}>
            <View style={[P.legendDot, { backgroundColor: '#1b4f72' }]} />
            <Text style={P.legendText}>Contractual position</Text>
          </View>
          <View style={P.legendItem}>
            <Text style={P.legendText}>F = facings</Text>
          </View>
        </View>

        {/* Fridge diagram */}
        {planogram ? (
          <>
            <View style={P.fridgeOuter}>
              <Text style={P.fridgeTitle}>FRIDGE VIEW (front)</Text>
              {planogram.shelves.map(shelf => (
                <ShelfRow
                  key={shelf.id}
                  shelf={shelf}
                  onPositionPress={slot => {
                    setSelectedSlot(prev => prev === slot && selectedShelfId === shelf.id ? null : slot);
                    setSelectedShelfId(shelf.id);
                  }}
                  selectedSlot={selectedShelfId === shelf.id ? selectedSlot : null}
                />
              ))}
            </View>

            {/* Selected position detail */}
            {selectedPos && (
              <View style={P.posDetail}>
                <Text style={P.posDetailName}>{selectedPos.productName}</Text>
                <Text style={P.posDetailReason}>{selectedPos.reason}</Text>
                <Text style={P.posDetailMeta}>{selectedPos.facings} facings · {selectedPos.temperature}</Text>
                {selectedPos.supplierRequirement && (
                  <View style={P.supplierNote}>
                    <Text style={P.supplierNoteText}>⚠️ Supplier requirement: {selectedPos.supplierRequirement}</Text>
                  </View>
                )}
              </View>
            )}

            {/* Supplier requirements checklist */}
            {planogram.requirementChecks.length > 0 && (
              <>
                <Text style={[P.sectionLabel, { marginTop: 20 }]}>SUPPLIER REQUIREMENTS</Text>
                {planogram.requirementChecks.map(rc => (
                  <View key={rc.productId} style={[P.reqRow, !rc.met && P.reqRowFail]}>
                    <Text style={[P.reqIcon, { color: rc.met ? '#16a34a' : '#d97706' }]}>
                      {rc.met ? '✓' : '⚠️'}
                    </Text>
                    <View style={{ flex: 1 }}>
                      <Text style={P.reqName}>{rc.productName}</Text>
                      <Text style={P.reqDetail}>{rc.required}</Text>
                    </View>
                  </View>
                ))}
              </>
            )}

            {/* Unplaced */}
            {planogram.unplacedProducts.length > 0 && (
              <>
                <Text style={[P.sectionLabel, { marginTop: 20 }]}>COULD NOT PLACE</Text>
                {planogram.unplacedProducts.map(u => (
                  <Text key={u.productId} style={P.unplacedText}>• {u.productName} — {u.reason}</Text>
                ))}
              </>
            )}

            <TouchableOpacity style={P.shareBtn} onPress={sharePlanogram}>
              <Text style={P.shareBtnText}>Print / share planogram</Text>
            </TouchableOpacity>
          </>
        ) : (
          <View style={P.emptyCard}>
            <Text style={P.emptyText}>No products found for this bar.</Text>
          </View>
        )}

      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const P = StyleSheet.create({
  comingSoon: { flex: 1, backgroundColor: '#f5f3ee', alignItems: 'center', justifyContent: 'center', padding: 36 },
  csEmoji:    { fontSize: 52, marginBottom: 20, textAlign: 'center' },
  csTitle:    { fontSize: 26, fontWeight: '800', color: '#0B132B', textAlign: 'center', marginBottom: 16 },
  csBody:     { fontSize: 16, color: '#6b7280', textAlign: 'center', lineHeight: 24, marginBottom: 12 },
  csContact:  { marginTop: 20, fontSize: 14, color: '#9ca3af', textAlign: 'center', lineHeight: 22 },

  scroll:      { padding: 16, paddingBottom: 40 },
  screenTitle: { fontSize: 22, fontWeight: '800', color: '#0B132B', marginBottom: 12 },
  sectionLabel:{ fontSize: 11, fontWeight: '800', color: '#9ca3af', letterSpacing: 1, marginBottom: 8 },

  legendRow:  { flexDirection: 'row', gap: 16, marginBottom: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot:  { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 12, color: '#6b7280' },

  fridgeOuter: { backgroundColor: '#fff', borderRadius: 14, borderWidth: 2, borderColor: '#d1d5db', padding: 10, marginBottom: 12 },
  fridgeTitle: { fontSize: 10, fontWeight: '800', color: '#9ca3af', letterSpacing: 1, marginBottom: 8, textAlign: 'center' },

  shelfContainer: { marginBottom: 8 },
  shelfLabel:     { fontSize: 11, fontWeight: '700', color: '#374151', marginBottom: 2 },
  shelfTemp:      { fontSize: 10, color: '#9ca3af', marginBottom: 4 },
  shelfRow:       { flexDirection: 'row', borderRadius: 8, padding: 6, minHeight: 60, gap: 6, borderWidth: 1, borderColor: '#e5e7eb' },
  shelfCell:      { width: 80, minHeight: 50, borderRadius: 6, backgroundColor: '#f3f4f6', borderWidth: 1, borderColor: '#e5e7eb', padding: 4, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  shelfCellSelected: { backgroundColor: '#1b4f72', borderColor: '#0f2d44' },
  shelfCellContractual: { borderColor: '#1b4f72', borderWidth: 1.5 },
  shelfCellText:  { fontSize: 9, fontWeight: '600', color: '#374151', textAlign: 'center' },
  shelfCellTextSelected: { color: '#fff' },
  shelfCellFacings: { fontSize: 8, color: '#9ca3af', marginTop: 2 },
  contractualDot: { position: 'absolute', top: 3, right: 3, width: 6, height: 6, borderRadius: 3, backgroundColor: '#1b4f72' },
  shelfEmpty:     { flex: 1, alignItems: 'center', justifyContent: 'center' },
  shelfEmptyText: { fontSize: 12, color: '#9ca3af', fontStyle: 'italic' },

  posDetail:     { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#e5e1d8' },
  posDetailName: { fontSize: 16, fontWeight: '800', color: '#0B132B', marginBottom: 4 },
  posDetailReason: { fontSize: 13, color: '#6b7280', marginBottom: 4 },
  posDetailMeta: { fontSize: 12, color: '#374151', fontWeight: '600' },
  supplierNote:  { backgroundColor: '#fffbeb', borderRadius: 8, padding: 8, marginTop: 8, borderWidth: 1, borderColor: '#fde68a' },
  supplierNoteText: { fontSize: 12, color: '#92400e' },

  reqRow:     { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 6, borderWidth: 1, borderColor: '#e5e7eb' },
  reqRowFail: { backgroundColor: '#fffbeb', borderColor: '#fde68a' },
  reqIcon:    { fontSize: 16, width: 20 },
  reqName:    { fontSize: 13, fontWeight: '700', color: '#0B132B' },
  reqDetail:  { fontSize: 12, color: '#6b7280', marginTop: 2 },

  unplacedText: { fontSize: 13, color: '#6b7280', lineHeight: 20, marginBottom: 4 },

  shareBtn:     { backgroundColor: '#1b4f72', borderRadius: 999, paddingVertical: 14, alignItems: 'center', marginTop: 24 },
  shareBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  emptyCard: { backgroundColor: '#fff', borderRadius: 12, padding: 24, alignItems: 'center', borderWidth: 1, borderColor: '#e5e1d8' },
  emptyText: { fontSize: 15, color: '#9ca3af', textAlign: 'center' },
});
