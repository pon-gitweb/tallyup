// @ts-nocheck
import React, { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { FESTIVAL_BETA } from '../../config/festivalBeta';

export default function FestivalSessionCountScreen() {
  const nav   = useNavigation<any>();
  const route = useRoute<any>();
  const { barId, barName } = route.params || {};

  useEffect(() => {
    if (!FESTIVAL_BETA || !barId) { nav.goBack(); return; }
    nav.replace('StockTakeArea', {
      departmentId: barId,
      areaId: 'back-of-house',
      isFestivalSession: true,
      sessionLabel: 'Session count',
      barName: barName || '',
    });
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: '#f5f3ee', alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator color="#1b4f72" size="large" />
    </View>
  );
}
