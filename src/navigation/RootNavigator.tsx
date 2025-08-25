import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { onAuthStateChanged, getAuth } from 'firebase/auth';

import AuthStack from './stacks/AuthStack';
import MainStack from './stacks/MainStack';
import SetupWizard from '../screens/setup/SetupWizard';

type Phase = 'loading' | 'auth' | 'main';
const Root = createNativeStackNavigator();

export default function RootNavigator() {
  const [phase, setPhase] = useState<Phase>('loading');

  useEffect(() => {
    const auth = getAuth();
    const unsub = onAuthStateChanged(auth, (u) => {
      console.log('[TallyUp Nav] auth state', JSON.stringify({ uid: u?.uid ?? null }));
      setPhase(u ? 'main' : 'auth');
    });
    return () => unsub();
  }, []);

  if (phase === 'loading') {
    return (
      <NavigationContainer>
        <View style={{ flex:1, alignItems:'center', justifyContent:'center' }}>
          <ActivityIndicator />
        </View>
      </NavigationContainer>
    );
  }

  return (
    <NavigationContainer>
      <Root.Navigator>
        {phase === 'auth' && (
          <Root.Screen name="Auth" component={AuthStack} options={{ headerShown: false }} />
        )}
        {phase === 'main' && (
          <Root.Screen name="Main" component={MainStack} options={{ headerShown: false }} />
        )}
        {/* Global fallback Setup route, always reachable */}
        <Root.Screen name="GlobalSetup" component={SetupWizard} options={{ title: 'Venue Setup' }} />
      </Root.Navigator>
    </NavigationContainer>
  );
}
