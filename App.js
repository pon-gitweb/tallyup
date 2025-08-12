import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Button, SafeAreaView, ActivityIndicator } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { auth } from './src/services/firebase';
import { onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { bootstrapIfNeeded } from './src/services/venueBootstrap';
import DashboardScreen from './src/screens/DashboardScreen';
import DepartmentSelectionScreen from './src/screens/DepartmentSelectionScreen';
import AreaSelectionScreen from './src/screens/AreaSelectionScreen';
import StockTakeAreaInventoryScreen from './src/screens/StockTakeAreaInventoryScreen';

const Stack = createNativeStackNavigator();

export default function App() {
  const [email, setEmail] = useState('test@example.com');
  const [password, setPassword] = useState('Password123!');
  const [user, setUser] = useState(null);
  const [busy, setBusy] = useState(false);
  const [venueId, setVenueId] = useState(null);

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  useEffect(() => {
    (async () => {
      if (!user) return;
      setBusy(true);
      const id = await bootstrapIfNeeded(user);
      if (id) setVenueId(id);
      setBusy(false);
    })();
  }, [user]);

  if (!user) {
    return (
      <SafeAreaView>
        <View style={{ padding: 24, gap: 12 }}>
          <Text style={{ fontWeight: '600' }}>Not signed in</Text>
          <TextInput placeholder="email" autoCapitalize="none" keyboardType="email-address"
            value={email} onChangeText={setEmail} style={{ borderWidth:1, padding:8 }} />
          <TextInput placeholder="password" secureTextEntry value={password}
            onChangeText={setPassword} style={{ borderWidth:1, padding:8 }} />
          <Button title="Sign Up" onPress={() => createUserWithEmailAndPassword(auth, email, password)} />
          <View style={{ height: 8 }} />
          <Button title="Sign In" onPress={() => signInWithEmailAndPassword(auth, email, password)} />
        </View>
      </SafeAreaView>
    );
  }

  if (busy || !venueId) {
    return (
      <SafeAreaView>
        <View style={{ flexDirection:'row', alignItems:'center', gap:8, padding: 24 }}>
          <ActivityIndicator />
          <Text>Preparing your venue…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator>
        <Stack.Screen name="Dashboard" component={DashboardScreen} initialParams={{ venueId }} />
        <Stack.Screen name="DepartmentSelection" component={DepartmentSelectionScreen} />
        <Stack.Screen name="AreaSelection" component={AreaSelectionScreen} />
        <Stack.Screen name="StockTakeAreaInventory" component={StockTakeAreaInventoryScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
