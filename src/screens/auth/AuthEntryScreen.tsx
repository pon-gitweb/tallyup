import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import { useVenueId } from '../../context/VenueProvider';

// Use your real screens (exact paths)
import LoginScreen from './LoginScreen';
import RegisterScreen from './RegisterScreen';
import SetupWizard from '../setup/SetupWizard';

type Tab = 'signin' | 'register';

export default function AuthEntryScreen() {
  const nav = useNavigation<any>();
  const [tab, setTab] = useState<Tab>('signin');
  const [showSetup, setShowSetup] = useState(false);
  const venueId = useVenueId();

  // After auth: if venue exists → Dashboard; else show SetupWizard
  useEffect(() => {
    const auth = getAuth();
    const unsub = onAuthStateChanged(auth, (u) => {
      if (!u) return;
      if (venueId) {
        nav.reset({ index: 0, routes: [{ name: 'Dashboard' }] });
      } else {
        setShowSetup(true);
      }
    });
    return () => unsub();
  }, [nav, venueId]);

  return (
    <View style={S.container}>
      <Text style={S.title}>Welcome to TallyUp</Text>

      <View style={S.tabs}>
        <TouchableOpacity onPress={() => setTab('signin')} style={[S.tab, tab === 'signin' && S.tabActive]}><Text>Sign In</Text></TouchableOpacity>
        <TouchableOpacity onPress={() => setTab('register')} style={[S.tab, tab === 'register' && S.tabActive]}><Text>Register</Text></TouchableOpacity>
      </View>

      {/* Render your modern screens directly */}
      <View style={{ flex: 1 }}>
        {tab === 'signin' ? <LoginScreen /> : <RegisterScreen />}
      </View>

      {/* Venue setup for new accounts (no props assumed) */}
      <Modal visible={showSetup} animationType="slide" onRequestClose={() => setShowSetup(false)}>
        <View style={{ flex: 1, backgroundColor: 'white' }}>
          <View style={S.modalHeader}>
            <Text style={S.modalTitle}>Set up your venue</Text>
          </View>
          <SetupWizard />
        </View>
      </Modal>
    </View>
  );
}

const S = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#fff' },
  title: { fontSize: 24, fontWeight: '700', marginBottom: 8, textAlign: 'center' },
  tabs: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  tab: { flex: 1, alignItems: 'center', padding: 10, borderWidth: 1, borderColor: '#ddd', borderRadius: 10 },
  tabActive: { backgroundColor: '#F3F4F6' },
  modalHeader: { padding: 12, borderBottomWidth: 1, borderColor: '#E5E7EB' },
  modalTitle: { fontSize: 18, fontWeight: '800', textAlign: 'center' },
});
