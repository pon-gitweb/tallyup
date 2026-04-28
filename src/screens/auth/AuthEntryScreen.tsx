import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import { useVenueId } from '../../context/VenueProvider';
import { useColours } from '../../context/ThemeContext';

import LoginScreen from './LoginScreen';
import RegisterScreen from './RegisterScreen';
import SetupWizard from '../setup/SetupWizard';

type Tab = 'signin' | 'register';

export default function AuthEntryScreen() {
  const nav = useNavigation<any>();
  const [tab, setTab] = useState<Tab>('signin');
  const [showSetup, setShowSetup] = useState(false);
  const venueId = useVenueId();
  const colours = useColours();

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

  const S = StyleSheet.create({
    container: { flex: 1, padding: 16, backgroundColor: colours.background },
    title: { fontSize: 24, fontWeight: '700', marginBottom: 8, textAlign: 'center', color: colours.text },
    tabs: { flexDirection: 'row', gap: 8, marginBottom: 8 },
    tab: { flex: 1, alignItems: 'center', padding: 10, borderWidth: 1, borderColor: colours.border, borderRadius: 10 },
    tabActive: { backgroundColor: colours.primaryLight },
    tabText: { color: colours.text, fontWeight: '600' },
    tabTextActive: { color: colours.primary },
    modalHeader: { padding: 12, borderBottomWidth: 1, borderColor: colours.border },
    modalTitle: { fontSize: 18, fontWeight: '800', textAlign: 'center', color: colours.text },
  });

  return (
    <View style={S.container}>
      <Text style={S.title}>Welcome to Hosti-Stock</Text>

      <View style={S.tabs}>
        <TouchableOpacity onPress={() => setTab('signin')} style={[S.tab, tab === 'signin' && S.tabActive]}>
          <Text style={[S.tabText, tab === 'signin' && S.tabTextActive]}>Sign In</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setTab('register')} style={[S.tab, tab === 'register' && S.tabActive]}>
          <Text style={[S.tabText, tab === 'register' && S.tabTextActive]}>Register</Text>
        </TouchableOpacity>
      </View>

      <View style={{ flex: 1 }}>
        {tab === 'signin' ? <LoginScreen /> : <RegisterScreen />}
      </View>

      <Modal visible={showSetup} animationType="slide" onRequestClose={() => setShowSetup(false)}>
        <View style={{ flex: 1, backgroundColor: colours.background }}>
          <View style={S.modalHeader}>
            <Text style={S.modalTitle}>Set up your venue</Text>
          </View>
          <SetupWizard />
        </View>
      </Modal>
    </View>
  );
}
