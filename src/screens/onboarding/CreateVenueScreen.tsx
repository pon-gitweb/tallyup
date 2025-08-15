import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { signOutAll } from '../../services/auth';

export default function CreateVenueScreen() {
  const onCreateVenue = () => {
    Alert.alert('Onboarding (stub)', 'Venue creation is not in MVP. Ask an admin to add you to a venue.');
  };

  const onBackToLogin = async () => {
    try {
      await signOutAll(); // auth observer will route to AuthEntry
    } catch (e: any) {
      Alert.alert('Sign out failed', e?.message ?? 'Unknown error');
    }
  };

  return (
    <View style={S.container}>
      <Text style={S.title}>Create or Join a Venue</Text>
      <Text style={S.copy}>You’re signed in but not attached to any venue yet.</Text>

      <TouchableOpacity style={S.primary} onPress={onCreateVenue}>
        <Text style={S.primaryText}>Create Venue (stub)</Text>
      </TouchableOpacity>

      <TouchableOpacity style={S.secondary} onPress={onBackToLogin}>
        <Text>Back to Login</Text>
      </TouchableOpacity>
    </View>
  );
}

const S = StyleSheet.create({
  container: { flex: 1, padding: 20, justifyContent: 'center', backgroundColor: '#fff' },
  title: { fontSize: 22, fontWeight: '700', marginBottom: 8, textAlign: 'center' },
  copy: { color: '#333', textAlign: 'center', marginBottom: 20 },
  primary: { backgroundColor: '#10B981', padding: 14, borderRadius: 10, alignItems: 'center', marginBottom: 10 },
  primaryText: { color: '#fff', fontWeight: '700' },
  secondary: { padding: 12, alignItems: 'center' },
});
