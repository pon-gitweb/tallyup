// @ts-nocheck
import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  ScrollView, Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { collection, getDocs, doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useVenueId } from '../../context/VenueProvider';
import { FESTIVAL_BETA } from '../../config/festivalBeta';

type HqArea = { id: string; name: string; itemCount: number };

export default function FestivalOpeningStockScreen() {
  const nav     = useNavigation<any>();
  const venueId = useVenueId();

  const [areas,   setAreas]   = useState<HqArea[]>([]);
  const [loading, setLoading] = useState(FESTIVAL_BETA);

  useEffect(() => {
    if (!FESTIVAL_BETA || !venueId) { setLoading(false); return; }
    (async () => {
      try {
        const areasSnap = await getDocs(
          collection(db, 'venues', venueId, 'departments', 'hq', 'areas')
        );
        const list: HqArea[] = await Promise.all(
          areasSnap.docs.map(async a => {
            let itemCount = 0;
            try {
              const items = await getDocs(
                collection(db, 'venues', venueId, 'departments', 'hq', 'areas', a.id, 'items')
              );
              itemCount = items.size;
            } catch {}
            return { id: a.id, name: (a.data() as any).name || a.id, itemCount };
          })
        );
        setAreas(list.filter(a => a.id !== 'main-storage' || a.itemCount > 0));
      } catch {}
      setLoading(false);
    })();
  }, [venueId]);

  if (!FESTIVAL_BETA) {
    return (
      <View style={S.center}>
        <Text style={S.body}>Festival mode is not enabled.</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={S.center}>
        <ActivityIndicator color="#1b4f72" size="large" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#f5f3ee' }}>
      <ScrollView contentContainerStyle={S.scroll}>
        <Text style={S.heading}>Opening stock count</Text>
        <Text style={S.sub}>
          Count stock in each HQ storage location before the event starts.
          Tap a location to count its products.
        </Text>

        {areas.length === 0 ? (
          <View style={S.emptyCard}>
            <Text style={S.emptyText}>
              No HQ storage locations set up yet.{'\n'}
              Add locations in Event Setup first.
            </Text>
            <TouchableOpacity
              style={S.secondaryBtn}
              onPress={() => nav.navigate('FestivalEventSetup', { section: 3 })}
            >
              <Text style={S.secondaryBtnText}>Go to Event Setup →</Text>
            </TouchableOpacity>
          </View>
        ) : (
          areas.map(area => (
            <TouchableOpacity
              key={area.id}
              style={S.areaCard}
              onPress={() =>
                nav.navigate('StockTakeArea', {
                  departmentId: 'hq',
                  areaId: area.id,
                  isFestivalSession: true,
                  sessionLabel: 'Opening stock',
                  barName: area.name,
                })
              }
              activeOpacity={0.75}
            >
              <View style={{ flex: 1 }}>
                <Text style={S.areaName}>{area.name}</Text>
                <Text style={S.areaCount}>
                  {area.itemCount > 0
                    ? `${area.itemCount} product${area.itemCount !== 1 ? 's' : ''} on record`
                    : 'No products yet — tap to add'}
                </Text>
              </View>
              <Text style={S.chevron}>›</Text>
            </TouchableOpacity>
          ))
        )}

        <TouchableOpacity
          style={S.doneBtn}
          onPress={() => nav.goBack()}
        >
          <Text style={S.doneBtnText}>Done</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const S = StyleSheet.create({
  center: { flex: 1, backgroundColor: '#f5f3ee', alignItems: 'center', justifyContent: 'center', padding: 24 },
  body:   { fontSize: 15, color: '#6b7280', textAlign: 'center' },
  scroll: { padding: 16, paddingBottom: 40 },
  heading:{ fontSize: 22, fontWeight: '800', color: '#0B132B', marginBottom: 6 },
  sub:    { fontSize: 14, color: '#6b7280', lineHeight: 20, marginBottom: 20 },

  areaCard: {
    backgroundColor: '#fff', borderRadius: 14, padding: 16, marginBottom: 10,
    borderWidth: 1, borderColor: '#e5e1d8', flexDirection: 'row', alignItems: 'center',
  },
  areaName:  { fontSize: 16, fontWeight: '800', color: '#0B132B', marginBottom: 2 },
  areaCount: { fontSize: 13, color: '#6b7280' },
  chevron:   { fontSize: 22, color: '#9ca3af', marginLeft: 8 },

  emptyCard: {
    backgroundColor: '#fff', borderRadius: 14, padding: 24, alignItems: 'center',
    borderWidth: 1, borderColor: '#e5e1d8', marginBottom: 12,
  },
  emptyText: { fontSize: 15, color: '#6b7280', textAlign: 'center', lineHeight: 22, marginBottom: 16 },

  secondaryBtn:     { borderWidth: 1.5, borderColor: '#1b4f72', borderRadius: 999, paddingVertical: 10, paddingHorizontal: 20, alignItems: 'center' },
  secondaryBtnText: { color: '#1b4f72', fontWeight: '700', fontSize: 14 },

  doneBtn:     { backgroundColor: '#1b4f72', borderRadius: 999, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  doneBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
