import React, { useMemo } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { View, ActivityIndicator, Text } from 'react-native';

import { useVenue } from '../context/VenueProvider';

// Stacks
import AuthStack from './stacks/AuthStack';
import MainStack from './stacks/MainStack';
import SetupStack from './stacks/SetupStack';

type Phase = 'loading' | 'auth' | 'setup' | 'app';

export default function RootNavigator() {
  const { loading, user, venueId } = useVenue();

  const phase: Phase = useMemo(() => {
    if (loading) return 'loading';
    if (!user) return 'auth';
    if (!venueId) return 'setup';
    return 'app';
  }, [loading, user, venueId]);

  console.log('[TallyUp RootNav] phase', JSON.stringify({ phase, uid: user?.uid ?? null, venueId: venueId ?? null }));

  if (phase === 'loading') {
    return (
      <View style={{ flex: 1, backgroundColor: '#0F1115', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
        <Text style={{ color: '#9AA4B2', marginTop: 8 }}>Loading…</Text>
      </View>
    );
  }

  // Key the container by phase so the navigator remounts when we move auth -> setup -> app
  return (
    <NavigationContainer key={phase}>
      {phase === 'auth' && <AuthStack />}
      {phase === 'setup' && <SetupStack onRefresh={() => { /* no-op; kept for compatibility */ }} />}
      {phase === 'app' && <MainStack />}
    </NavigationContainer>
  );
}
