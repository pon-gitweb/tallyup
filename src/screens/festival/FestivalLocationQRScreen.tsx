// @ts-nocheck
import React from 'react';
import {
  View, Text, StyleSheet, ScrollView,
} from 'react-native';
import { useRoute } from '@react-navigation/native';
import QRCode from 'react-native-qrcode-svg';
import { FESTIVAL_BETA } from '../../config/festivalBeta';
import { useColours } from '../../context/ThemeContext';

// ─── QR payload format ────────────────────────────────────────────────────────
// "hosti-loc:{departmentId}:{areaId}"
// Static, never expires — identifies a physical location, not a session.

export default function FestivalLocationQRScreen() {
  const route = useRoute<any>();
  const { departmentId, areaId, displayName } = route.params || {};
  const c = useColours();
  const S = makeStyles(c);

  if (!FESTIVAL_BETA) {
    return (
      <View style={S.center}>
        <Text style={S.csEmoji}>🎪</Text>
        <Text style={S.csTitle}>Festival mode</Text>
        <Text style={S.csBody}>
          We're building something great for festival and event operators.{'\n'}
          Coming soon — we'll let you know when it's live.
        </Text>
        <Text style={S.csContact}>Questions? office@hosti.co.nz</Text>
      </View>
    );
  }

  if (!departmentId || !areaId) {
    return (
      <View style={S.center}>
        <Text style={S.csTitle}>Missing location</Text>
        <Text style={S.csBody}>departmentId and areaId are required.</Text>
      </View>
    );
  }

  const payload = `hosti-loc:${departmentId}:${areaId}`;

  return (
    <ScrollView contentContainerStyle={S.scroll}>

      <View style={S.card}>
        {/* Location name */}
        <Text style={S.locationName}>{displayName || areaId}</Text>

        {/* QR code */}
        <View style={S.qrWrapper}>
          <QRCode
            value={payload}
            size={220}
            color={c.navy}
            backgroundColor={c.surface}
            quietZone={16}
          />
        </View>

        {/* Human-readable identity */}
        <View style={S.metaBlock}>
          <View style={S.metaRow}>
            <Text style={S.metaLabel}>Department</Text>
            <Text style={S.metaValue}>{departmentId}</Text>
          </View>
          <View style={S.divider} />
          <View style={S.metaRow}>
            <Text style={S.metaLabel}>Area</Text>
            <Text style={S.metaValue}>{areaId}</Text>
          </View>
          <View style={S.divider} />
          <View style={S.metaRow}>
            <Text style={S.metaLabel}>Payload</Text>
            <Text style={[S.metaValue, S.metaPayload]} numberOfLines={2}>{payload}</Text>
          </View>
        </View>
      </View>

      {/* Instructions */}
      <View style={S.infoCard}>
        <Text style={S.infoText}>
          Print or display this code at the location so runners can scan it to confirm pick-up or delivery.
        </Text>
      </View>

    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
function makeStyles(c: any) {
  return StyleSheet.create({
    center: {
      flex: 1, backgroundColor: c.oat,
      alignItems: 'center', justifyContent: 'center', padding: 36,
    },
    csEmoji:   { fontSize: 52, marginBottom: 20, textAlign: 'center' },
    csTitle:   { fontSize: 26, fontWeight: '800', color: c.navy, textAlign: 'center', marginBottom: 16 },
    csBody:    { fontSize: 16, color: c.slateMid, textAlign: 'center', lineHeight: 24, marginBottom: 12 },
    csContact: { marginTop: 20, fontSize: 14, color: c.slateMid, textAlign: 'center', lineHeight: 22 },

    scroll: {
      flexGrow: 1, backgroundColor: c.oat,
      alignItems: 'center', padding: 24, paddingBottom: 40,
    },

    card: {
      width: '100%', maxWidth: 360,
      backgroundColor: c.surface, borderRadius: 20,
      padding: 24, alignItems: 'center',
      borderWidth: 1, borderColor: c.border,
      shadowColor: c.navy, shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
    },

    locationName: {
      fontSize: 20, fontWeight: '800', color: c.navy,
      textAlign: 'center', marginBottom: 24,
    },

    qrWrapper: {
      padding: 12, backgroundColor: c.surface,
      borderRadius: 12, borderWidth: 1, borderColor: c.border,
      marginBottom: 24,
    },

    metaBlock: {
      width: '100%', backgroundColor: c.oat,
      borderRadius: 10, borderWidth: 1, borderColor: c.border,
      overflow: 'hidden',
    },
    metaRow: {
      flexDirection: 'row', alignItems: 'flex-start',
      paddingVertical: 10, paddingHorizontal: 14, gap: 12,
    },
    divider: { height: 1, backgroundColor: c.border },
    metaLabel: {
      fontSize: 12, fontWeight: '700', color: c.slateMid,
      width: 82, paddingTop: 1,
    },
    metaValue: {
      fontSize: 13, color: c.navy, fontWeight: '600', flex: 1,
    },
    metaPayload: {
      fontFamily: 'Courier', fontSize: 12, color: c.slateMid, fontWeight: '400',
    },

    infoCard: {
      marginTop: 20, width: '100%', maxWidth: 360,
      backgroundColor: c.surface, borderRadius: 12,
      padding: 16, borderWidth: 1, borderColor: c.border,
    },
    infoText: {
      fontSize: 13, color: c.slateMid, textAlign: 'center', lineHeight: 19,
    },
  });
}
