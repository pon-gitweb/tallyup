// @ts-nocheck
import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  ScrollView, Alert, Share,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useVenueId } from '../../context/VenueProvider';
import { FESTIVAL_BETA } from '../../config/festivalBeta';
import {
  calculateContainerLayout,
  type ContainerLayoutResult,
  type LayoutZone,
  type ContainerProduct,
} from '../../services/festival/containerLayout';

// ─── Zone diagram colour map ──────────────────────────────────────────────────

const ZONE_COLORS: Record<string, string> = {
  'front-left':  '#bfdbfe',
  'front-right': '#bfdbfe',
  'mid-left':    '#bbf7d0',
  'mid-right':   '#bbf7d0',
  'back-left':   '#fde68a',
  'back-right':  '#fde68a',
};

// ─── Top-down container diagram ───────────────────────────────────────────────

function ContainerDiagram({
  zones,
  onZonePress,
  selectedZone,
}: {
  zones: LayoutZone[];
  onZonePress: (z: LayoutZone) => void;
  selectedZone: string | null;
}) {
  const W = 280;
  const H = 180;
  const aisleW = 48;
  const sideW = (W - aisleW) / 2;
  const rowH = H / 3;

  const cells: { id: LayoutZone['id']; x: number; y: number; w: number; h: number; label: string }[] = [
    { id: 'front-left',  x: 0,              y: 0,         w: sideW, h: rowH, label: 'Front\nLeft' },
    { id: 'front-right', x: sideW + aisleW, y: 0,         w: sideW, h: rowH, label: 'Front\nRight' },
    { id: 'mid-left',    x: 0,              y: rowH,      w: sideW, h: rowH, label: 'Mid\nLeft' },
    { id: 'mid-right',   x: sideW + aisleW, y: rowH,      w: sideW, h: rowH, label: 'Mid\nRight' },
    { id: 'back-left',   x: 0,              y: rowH * 2,  w: sideW, h: rowH, label: 'Back\nLeft' },
    { id: 'back-right',  x: sideW + aisleW, y: rowH * 2,  w: sideW, h: rowH, label: 'Back\nRight' },
  ];

  return (
    <View style={{ width: W, height: H, position: 'relative', borderWidth: 1.5, borderColor: '#374151', borderRadius: 6, overflow: 'hidden', alignSelf: 'center' }}>
      {/* Aisle */}
      <View style={{
        position: 'absolute', left: sideW, top: 0,
        width: aisleW, height: H,
        backgroundColor: '#f3f4f6',
        borderLeftWidth: 1, borderRightWidth: 1, borderColor: '#d1d5db',
        alignItems: 'center', justifyContent: 'center',
      }}>
        <Text style={{ fontSize: 8, color: '#9ca3af', fontWeight: '700', transform: [{ rotate: '90deg' }] }}>AISLE</Text>
      </View>
      {/* Door arrow */}
      <View style={{ position: 'absolute', left: sideW, top: H - 20, width: aisleW, alignItems: 'center' }}>
        <Text style={{ fontSize: 10 }}>🚪</Text>
      </View>

      {cells.map(cell => {
        const zone = zones.find(z => z.id === cell.id);
        const fillPct = zone && zone.capacityCases > 0 ? zone.usedCases / zone.capacityCases : 0;
        const isSelected = selectedZone === cell.id;
        return (
          <TouchableOpacity
            key={cell.id}
            style={{
              position: 'absolute',
              left: cell.x, top: cell.y,
              width: cell.w, height: cell.h,
              backgroundColor: isSelected ? '#1b4f72' : ZONE_COLORS[cell.id] ?? '#e5e7eb',
              borderWidth: isSelected ? 2 : 0.5,
              borderColor: isSelected ? '#0f2d44' : '#9ca3af',
              alignItems: 'center', justifyContent: 'center',
              padding: 2,
            }}
            onPress={() => zone && onZonePress(zone)}
          >
            <Text style={{ fontSize: 7, fontWeight: '700', color: isSelected ? '#fff' : '#374151', textAlign: 'center' }}>
              {cell.label}
            </Text>
            {zone && zone.products.length > 0 && (
              <Text style={{ fontSize: 7, color: isSelected ? '#bfdbfe' : '#6b7280', textAlign: 'center' }}>
                {zone.products.map(p => p.productName.split(' ')[0]).join(', ')}
              </Text>
            )}
            {/* Fill indicator strip */}
            <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 3, backgroundColor: '#e5e7eb' }}>
              <View style={{ width: `${Math.round(fillPct * 100)}%`, height: 3, backgroundColor: '#1b4f72' }} />
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ─── Chasing 5 guide ──────────────────────────────────────────────────────────

function ChasingFiveGuide({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  return (
    <View style={L.guideCard}>
      <TouchableOpacity onPress={onToggle} style={L.guideHeader}>
        <Text style={L.guideTitle}>What is Chasing 5?</Text>
        <Text style={L.guideChevron}>{expanded ? '▲' : '▼'}</Text>
      </TouchableOpacity>
      {expanded && (
        <View>
          <Text style={L.guideBody}>
            Chasing 5 is a brick-stacking pattern where each layer is offset, creating a stable interlocked stack. Cases are laid on their side in alternating directions.
          </Text>
          <Text style={L.guideCode}>
            {'Layer 1:  [A][B][C][D][E]\nLayer 2:  [B][C][D][E][A]\nLayer 3:  [C][D][E][A][B]\n              (rotates each layer)'}
          </Text>
          <Text style={L.guideBody}>
            Benefits: reduces movement during transport, easier to count, natural FIFO rotation when loading front-to-back.
          </Text>
        </View>
      )}
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function FestivalContainerLayoutScreen() {
  const nav     = useNavigation<any>();
  const route   = useRoute<any>();
  const venueId = useVenueId();
  const { containerId, containerName, containerType } = route.params || {};

  const [layout,       setLayout]       = useState<ContainerLayoutResult | null>(null);
  const [selectedZone, setSelectedZone] = useState<LayoutZone | null>(null);
  const [loading,      setLoading]      = useState(FESTIVAL_BETA);
  const [chasingOpen,  setChasingOpen]  = useState(false);

  useEffect(() => {
    if (!FESTIVAL_BETA || !venueId) { setLoading(false); return; }
    buildLayout();
  }, [venueId, containerId]);

  async function buildLayout() {
    try {
      // Load source location products assigned to this container
      const stockSnap = await getDocs(
        collection(db, 'venues', venueId, 'departments', 'hq', 'areas', containerId ?? 'default', 'items'),
      );

      const products: ContainerProduct[] = stockSnap.docs.map((d, i) => {
        const data = d.data() as any;
        return {
          id:           d.id,
          name:         data.name || d.id,
          casesNeeded:  Math.ceil((data.plannedQty ?? data.lastCount ?? 0) / (data.unitsPerCase ?? 1)),
          caseWidthMM:  data.caseWidthMM  ?? 300,
          caseLengthMM: data.caseLengthMM ?? 400,
          caseHeightMM: data.caseHeightMM ?? 280,
          velocityRank: i + 1,
          supplierContractual: data.supplierContractual ?? false,
        };
      });

      const container = {
        name:     containerName || 'Container',
        widthMM:  2438,   // Standard 20ft: 2438mm interior width
        lengthMM: 5900,   // Standard 20ft: 5900mm interior length
        heightMM: 2390,   // Standard 20ft: 2390mm interior height
      };

      const result = calculateContainerLayout(container, products);
      setLayout(result);
    } catch {
      setLayout(null);
    } finally {
      setLoading(false);
    }
  }

  async function shareLoadingGuide() {
    if (!layout) return;
    const lines: string[] = [`LOADING GUIDE — ${containerName || 'Container'}`, ''];
    for (const step of layout.loadingOrder) {
      lines.push(`${step.step}. ${step.action}: ${step.productName} × ${step.cases} cases`);
    }
    if (layout.overflow.length > 0) {
      lines.push('', 'OVERFLOW (does not fit):');
      for (const o of layout.overflow) {
        lines.push(`  • ${o.productName}: ${o.overflowCases} cases`);
      }
    }
    lines.push('', 'GUIDANCE:');
    for (const g of layout.guidance) lines.push(`• ${g}`);
    try {
      await Share.share({ message: lines.join('\n'), title: 'Loading Guide' });
    } catch {}
  }

  // ── Coming-soon gate ──────────────────────────────────────────────────────
  if (!FESTIVAL_BETA) {
    return (
      <View style={L.comingSoon}>
        <Text style={L.csEmoji}>🎪</Text>
        <Text style={L.csTitle}>Festival mode</Text>
        <Text style={L.csBody}>
          We're building something great for festival and event operators.{'\n'}
          Coming soon — we'll let you know when it's live.
        </Text>
        <Text style={L.csContact}>Questions? office@hosti.co.nz</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={L.comingSoon}>
        <ActivityIndicator color="#1b4f72" size="large" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#f5f3ee' }}>
      <ScrollView contentContainerStyle={L.scroll}>

        {/* Header */}
        <Text style={L.screenTitle}>{containerName || 'Container'}</Text>
        {containerType ? <Text style={L.subTitle}>{containerType}</Text> : null}

        {layout && (
          <Text style={L.capacityText}>
            {layout.totalAssignedCases} / {layout.totalCapacityCases} cases assigned
          </Text>
        )}

        {/* Diagram */}
        {layout && (
          <>
            <Text style={L.sectionLabel}>TOP-DOWN VIEW</Text>
            <Text style={L.diagramNote}>Front = door end. Tap a zone for detail.</Text>
            <ContainerDiagram
              zones={layout.zones}
              onZonePress={z => setSelectedZone(prev => prev?.id === z.id ? null : z)}
              selectedZone={selectedZone?.id ?? null}
            />

            {/* Zone detail */}
            {selectedZone && (
              <View style={L.zoneDetail}>
                <Text style={L.zoneDetailTitle}>{selectedZone.label}</Text>
                {selectedZone.products.length === 0 ? (
                  <Text style={L.emptyText}>Empty zone</Text>
                ) : (
                  selectedZone.products.map(p => (
                    <View key={p.productId} style={L.zoneProdRow}>
                      <Text style={L.zoneProdName}>{p.productName}</Text>
                      <Text style={L.zoneProdDetail}>
                        {p.casesAssigned} cases · {p.casesWide}W × {p.casesDeep}D · {p.stackingPattern} · stack {Math.round(p.stackHeight / 10)}cm
                      </Text>
                    </View>
                  ))
                )}
              </View>
            )}

            {/* Loading order */}
            <Text style={[L.sectionLabel, { marginTop: 20 }]}>LOADING ORDER (back → front)</Text>
            {layout.loadingOrder.map(step => (
              <View key={step.step} style={L.loadStep}>
                <View style={L.stepNum}>
                  <Text style={L.stepNumText}>{step.step}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={L.stepAction}>{step.action}</Text>
                  <Text style={L.stepDetail}>{step.productName} × {step.cases} cases</Text>
                </View>
              </View>
            ))}

            {/* Chasing 5 guide */}
            <ChasingFiveGuide expanded={chasingOpen} onToggle={() => setChasingOpen(v => !v)} />

            {/* Overflow */}
            {layout.overflow.length > 0 && (
              <>
                <Text style={[L.sectionLabel, { marginTop: 20 }]}>OVERFLOW — DOES NOT FIT</Text>
                {layout.overflow.map(o => (
                  <View key={o.productId} style={L.overflowCard}>
                    <Text style={L.overflowName}>{o.productName}</Text>
                    <Text style={L.overflowDetail}>{o.overflowCases} cases overflow</Text>
                  </View>
                ))}
              </>
            )}

            {/* Guidance */}
            <Text style={[L.sectionLabel, { marginTop: 20 }]}>GUIDANCE</Text>
            {layout.guidance.map((g, i) => (
              <Text key={i} style={L.guidanceText}>• {g}</Text>
            ))}

            {/* Share */}
            <TouchableOpacity style={L.shareBtn} onPress={shareLoadingGuide}>
              <Text style={L.shareBtnText}>Share loading guide</Text>
            </TouchableOpacity>
          </>
        )}

        {!layout && (
          <View style={L.emptyCard}>
            <Text style={L.emptyText}>No products assigned to this container yet.</Text>
          </View>
        )}

      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const L = StyleSheet.create({
  comingSoon: { flex: 1, backgroundColor: '#f5f3ee', alignItems: 'center', justifyContent: 'center', padding: 36 },
  csEmoji:    { fontSize: 52, marginBottom: 20, textAlign: 'center' },
  csTitle:    { fontSize: 26, fontWeight: '800', color: '#0B132B', textAlign: 'center', marginBottom: 16 },
  csBody:     { fontSize: 16, color: '#6b7280', textAlign: 'center', lineHeight: 24, marginBottom: 12 },
  csContact:  { marginTop: 20, fontSize: 14, color: '#9ca3af', textAlign: 'center', lineHeight: 22 },

  scroll:       { padding: 16, paddingBottom: 40 },
  screenTitle:  { fontSize: 22, fontWeight: '800', color: '#0B132B', marginBottom: 4 },
  subTitle:     { fontSize: 14, color: '#6b7280', marginBottom: 4 },
  capacityText: { fontSize: 13, color: '#374151', fontWeight: '600', marginBottom: 16 },
  sectionLabel: { fontSize: 11, fontWeight: '800', color: '#9ca3af', letterSpacing: 1, marginBottom: 8 },
  diagramNote:  { fontSize: 12, color: '#9ca3af', marginBottom: 10 },

  zoneDetail:      { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginTop: 12, borderWidth: 1, borderColor: '#e5e1d8' },
  zoneDetailTitle: { fontSize: 15, fontWeight: '800', color: '#0B132B', marginBottom: 8 },
  zoneProdRow:     { marginBottom: 8 },
  zoneProdName:    { fontSize: 14, fontWeight: '700', color: '#1b4f72' },
  zoneProdDetail:  { fontSize: 12, color: '#6b7280', marginTop: 2 },

  loadStep:   { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 10 },
  stepNum:    { width: 28, height: 28, borderRadius: 14, backgroundColor: '#1b4f72', alignItems: 'center', justifyContent: 'center' },
  stepNumText:{ fontSize: 12, fontWeight: '800', color: '#fff' },
  stepAction: { fontSize: 13, fontWeight: '700', color: '#374151' },
  stepDetail: { fontSize: 12, color: '#6b7280' },

  guideCard:   { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginTop: 16, borderWidth: 1, borderColor: '#e5e1d8' },
  guideHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  guideTitle:  { fontSize: 14, fontWeight: '700', color: '#0B132B' },
  guideChevron:{ fontSize: 12, color: '#6b7280' },
  guideBody:   { fontSize: 13, color: '#374151', lineHeight: 20, marginTop: 8 },
  guideCode:   { fontFamily: 'Courier', fontSize: 11, color: '#374151', backgroundColor: '#f3f4f6', borderRadius: 6, padding: 10, marginTop: 8 },

  overflowCard:   { backgroundColor: '#fef2f2', borderRadius: 10, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: '#fca5a5' },
  overflowName:   { fontSize: 14, fontWeight: '700', color: '#dc2626' },
  overflowDetail: { fontSize: 12, color: '#dc2626', marginTop: 2 },

  guidanceText: { fontSize: 13, color: '#374151', lineHeight: 20, marginBottom: 4 },

  shareBtn:     { backgroundColor: '#1b4f72', borderRadius: 999, paddingVertical: 14, alignItems: 'center', marginTop: 24 },
  shareBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  emptyCard: { backgroundColor: '#fff', borderRadius: 12, padding: 24, alignItems: 'center', borderWidth: 1, borderColor: '#e5e1d8', marginTop: 16 },
  emptyText: { fontSize: 15, color: '#9ca3af', textAlign: 'center' },
});
