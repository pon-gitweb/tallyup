import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView } from 'react-native';
import { getAuth } from 'firebase/auth';

/**
 * Shown on iOS when a signed-in user has no venue.
 * Apple guideline 3.1.1: no account/venue creation links, no pricing, no website.
 */
export default function NoVenueScreen() {
  const handleSignOut = async () => {
    try {
      await getAuth().signOut();
    } catch {}
  };

  return (
    <SafeAreaView style={S.safe}>
      <View style={S.card}>
        <Text style={S.heading}>No venue yet</Text>
        <Text style={S.body}>
          {"You're not part of a venue yet.\n\nAsk your venue owner or manager to send you an invite."}
        </Text>
      </View>
      <TouchableOpacity style={S.signOutBtn} onPress={handleSignOut} activeOpacity={0.85}>
        <Text style={S.signOutText}>Sign out</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const S = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: '#f5f3ee', justifyContent: 'center', padding: 24 },
  card:       { backgroundColor: '#fff', borderRadius: 16, padding: 24, borderWidth: 1, borderColor: '#e5e1d8', marginBottom: 24 },
  heading:    { fontSize: 20, fontWeight: '800', color: '#1b4f72', marginBottom: 12 },
  body:       { fontSize: 15, color: '#374151', lineHeight: 24 },
  signOutBtn: { backgroundColor: '#1b4f72', borderRadius: 999, paddingVertical: 14, alignItems: 'center' },
  signOutText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
