import React, { useEffect, useState } from 'react';
import { View, Text, Button, SafeAreaView, ActivityIndicator, Alert } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { getDashboardButtonState, getOrStartActiveStockTake } from '../services/stockTakeService';

export default function DashboardScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { venueId } = route.params;

  const [loading, setLoading] = useState(true);
  const [btnLabel, setBtnLabel] = useState('Start Stock Take');
  const [activeStockTakeId, setActiveStockTakeId] = useState(null);

  const refresh = async () => {
    try {
      setLoading(true);
      const state = await getDashboardButtonState(venueId);
      setBtnLabel(state.label);
      setActiveStockTakeId(state.stockTakeId);
    } catch (err) {
      console.error('[Dashboard] refresh error', err);
      Alert.alert('Error', 'Could not load stock take state.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', refresh);
    return unsubscribe;
  }, [navigation]);

  const onPress = async () => {
    try {
      const stockTakeId = activeStockTakeId || await getOrStartActiveStockTake(venueId);
      navigation.navigate('DepartmentSelection', { venueId, stockTakeId });
    } catch (err) {
      console.error('[Dashboard] start error', err);
      Alert.alert('Error', 'Could not start or resume a stock take.');
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, padding: 24 }}>
      <Text style={{ fontSize: 22, fontWeight: '700' }}>Dashboard</Text>
      <View style={{ marginTop: 20 }}>
        {loading ? (
          <ActivityIndicator />
        ) : (
          <Button title={btnLabel} onPress={onPress} />
        )}
      </View>
    </SafeAreaView>
  );
}
