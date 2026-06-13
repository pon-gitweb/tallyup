// @ts-nocheck
import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, TextInput } from 'react-native';
import { createVenueOwnedByCurrentUser } from '../../services/venues';
import { signOutAll } from '../../services/auth';
import { useNavigation } from '@react-navigation/native';
import { seedDefaultDepartmentsAndAreas } from '../../services/onboarding/defaultDepartments';
import { useColours, useTheme } from '../../context/ThemeContext';
import { useToast } from '../../components/common/Toast';
import { useConfirmModal } from '../../components/common/useConfirmModal';

export default function CreateVenueScreen() {
  const nav = useNavigation<any>();
  const c = useColours();
  const { theme } = useTheme();
  const { showSuccess, showError, showInfo } = useToast();
  const { confirm, modal } = useConfirmModal();
  const S = makeStyles(c);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const onCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      showInfo('Please enter a venue name.');
      return;
    }
    try {
      setBusy(true);

      // 1) Create venue via Cloud Function
      const { venueId } = await createVenueOwnedByCurrentUser(trimmed);

      // 2) Seed default departments + areas for this new venue
      try {
        const result = await seedDefaultDepartmentsAndAreas(venueId);
        if (__DEV__) console.log('[Onboarding] seeded default departments/areas', { venueId, result });
      } catch (e: any) {
        // Don’t block user if seeding fails – log for dev
        if (__DEV__) console.log('[Onboarding] seedDefaultDepartmentsAndAreas failed', e?.code, e?.message || String(e));
      }

      // 3) Move them into the new venue dashboard
      // VenueProvider's onSnapshot on users/{uid} picks up the new venueId
      // and routes the user to the main app automatically.
      // Kept as Alert.alert (per design spec): success already triggers auto-navigation.
      Alert.alert('Venue created', `Welcome to ${trimmed}! Setting things up…`);
    } catch (e: any) {
      showError(e?.message ?? 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  const onJoinWithCode = () => {
    showInfo('Coming soon (MVP++). Ask your admin for an invite code.');
  };

  const onBackToLogin = async () => {
    try {
      setBusy(true);
      await signOutAll();
    } catch (e: any) {
      showError(e?.message ?? 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={S.container}>
      {modal}
      <Text style={S.title}>Create or Join a Venue</Text>
      <Text style={S.copy}>You’re signed in but not attached to any venue yet.</Text>

      <View style={S.card}>
        <Text style={S.label}>Venue name</Text>
        <TextInput
          style={S.input}
          placeholder="e.g., The Front Bar"
          value={name}
          onChangeText={setName}
          editable={!busy}
        />
        <TouchableOpacity style={[S.primary, busy && S.disabled]} onPress={onCreate} disabled={busy}>
          <Text style={S.primaryText}>{busy ? 'Creating…' : 'Create Venue'}</Text>
        </TouchableOpacity>
      </View>

      <View style={S.cardAlt}>
        <Text style={S.subhead}>Already have a venue?</Text>
        <TouchableOpacity style={S.secondary} onPress={onJoinWithCode} disabled={busy}>
          <Text style={S.secondaryText}>Join with invite code (coming soon)</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={S.link} onPress={onBackToLogin} disabled={busy}>
        <Text style={S.linkText}>Back to Login</Text>
      </TouchableOpacity>
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
    container: { flex: 1, padding: 20, justifyContent: 'center', backgroundColor: c.surface },
    title: { fontSize: 22, fontWeight: '700', marginBottom: 6, textAlign: 'center' },
    copy: { color: c.text, textAlign: 'center', marginBottom: 16 },
    card: { backgroundColor: c.oat, padding: 14, borderRadius: 12, marginBottom: 10 },
    label: { fontWeight: '600', marginBottom: 6 },
    input: {
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 10,
      padding: 12,
      backgroundColor: c.surface,
      marginBottom: 10,
    },
    primary: { backgroundColor: c.success, padding: 14, borderRadius: 10, alignItems: 'center' },
    primaryText: { color: c.surface, fontWeight: '700' },
    disabled: { opacity: 0.6 },
    cardAlt: {
      backgroundColor: c.primaryLight,
      padding: 12,
      borderRadius: 12,
      marginBottom: 10,
      borderColor: c.border,
      borderWidth: 1,
    },
    subhead: { fontWeight: '700', marginBottom: 6, color: c.deepBlue },
    secondary: { backgroundColor: c.border, padding: 12, borderRadius: 10, alignItems: 'center' },
    secondaryText: { color: c.text, fontWeight: '600' },
    link: { alignItems: 'center', marginTop: 10 },
    linkText: { color: c.deepBlue, fontWeight: '600' },
  });
}
