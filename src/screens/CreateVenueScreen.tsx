import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { getAuth, signOut } from 'firebase/auth';
import { db } from '../services/firebase';
import { arrayUnion, collection, doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import { useColours, useTheme } from '../context/ThemeContext';
import { useToast } from '../components/common/Toast';

export default function CreateVenueScreen() {
  const c = useColours();
  const { theme } = useTheme();
  const { showError } = useToast();
  const [name, setName] = useState('');
  const [projectType, setProjectType] = useState<'venue' | 'festival' | null>(null);
  const [country, setCountry] = useState<'NZ' | 'AU'>('NZ');
  const [busy, setBusy] = useState(false);
  const navigation = useNavigation<any>();

  async function handleCreate() {
    const auth = getAuth();
    const uid = auth.currentUser?.uid || null;
    if (!uid) {
      Alert.alert('Not signed in', 'Please sign in first.');
      return;
    }
    if (!name.trim()) {
      Alert.alert('Name required', 'Please enter a name.');
      return;
    }
    if (!projectType) {
      Alert.alert('Choose a type', 'Please choose whether this is a venue or a festival.');
      return;
    }

    setBusy(true);
    console.log('[CreateVenue] start', JSON.stringify({ name }));

    const timeoutId = setTimeout(() => {
      setBusy(false);
      Alert.alert(
        'Taking longer than usual',
        'Your project is being set up. Please wait a moment then reopen the app.'
      );
    }, 10000);

    try {
      // (A) Ensure users/{uid} exists and prime venueId:null if missing (future-proof for rules)
      const uref = doc(db, 'users', uid);
      const usnap = await getDoc(uref);
      const hasVenueIdKey = usnap.exists() && Object.prototype.hasOwnProperty.call(usnap.data() || {}, 'venueId');

      if (!usnap.exists()) {
        await setDoc(uref, { createdAt: new Date(), email: auth.currentUser?.email ?? null, venueId: null }, { merge: true });
      } else if (!hasVenueIdKey) {
        await setDoc(uref, { venueId: null }, { merge: true });
      }

      console.log('[CreateVenue] users/{uid} primed', JSON.stringify({
        path: uref.path, primedVenueIdNull: !hasVenueIdKey,
      }));

      // (B) Create the venue parent with ownerUid (rules: canCreateFirstVenue + ownerUid == uid)
      const vref = doc(collection(db, 'venues'));
      await setDoc(vref, {
        name: name.trim(),
        ownerUid: uid,
        venueType: projectType,
        country,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      console.log('[CreateVenue] venues/{id} created', JSON.stringify({ venueId: vref.id }));

      // (C) Set users/{uid}.venueId + add to venueIds array + set activeVenueId
      await updateDoc(uref, {
        venueId: vref.id,         // keep legacy field
        activeVenueId: vref.id,
        venueIds: arrayUnion(vref.id),
        touchedAt: new Date(),
      });
      console.log('[CreateVenue] users/{uid} venue fields set', JSON.stringify({ uid, venueId: vref.id }));

      // (D) Add membership (owner)
      const mref = doc(db, 'venues', vref.id, 'members', uid);
      await setDoc(mref, { role: 'owner', createdAt: serverTimestamp() }, { merge: true });
      console.log('[CreateVenue] members/{uid} upserted', JSON.stringify({ path: mref.path }));

      // (E) Seed departments/areas sequentially (non-fatal if denied—Setup can fill later)
      const nowBase = { createdAt: serverTimestamp(), updatedAt: serverTimestamp() };

      async function seedDept(deptName: string, areaNames: string[]) {
        const dref = doc(db, 'venues', vref.id, 'departments', deptName);
        await setDoc(dref, { name: deptName, ...nowBase }, { merge: true });
        console.log('[CreateVenue] seed department', JSON.stringify({ path: dref.path }));

        for (const area of areaNames) {
          const aref = doc(db, 'venues', vref.id, 'departments', deptName, 'areas', area);
          await setDoc(aref, { name: area, startedAt: null, completedAt: null, ...nowBase }, { merge: true });
          console.log('[CreateVenue] seed area', JSON.stringify({ path: aref.path }));
        }
      }

      // Only seed permanent-venue departments — festival accounts start clean
      // (HQ and bar departments are created by the festival event setup wizard)
      if (projectType === 'venue') {
        try {
          await seedDept('Bar', ['Front Bar', 'Back Bar', 'Fridge', 'Cellar']);
          await seedDept('Kitchen', ['Prep', 'Line', 'Dry Store', 'Cool Room']);
        } catch (e: any) {
          console.log('[CreateVenue] seed warning', JSON.stringify({ code: e?.code, message: e?.message }));
        }
      }

      clearTimeout(timeoutId);

      // Clear stale device state from any previous venue/account on this device.
      // lastKnownVenueType must reflect the NEW venue so the HomeRouter timeout
      // doesn't accidentally route to festival if the previous account was one.
      await AsyncStorage.multiRemove([
        'lastKnownVenueType',
        'setup_wizard_seen',
        'setupProgress',
        'setupGuideStep',
        'onboardingRoad',
      ]).catch(() => {});
      // Prime the correct type immediately so the 5s timeout also routes correctly.
      await AsyncStorage.setItem('lastKnownVenueType', projectType).catch(() => {});

      navigation.reset({
        index: 0,
        routes: [{ name: 'HomeRouter' }],
      });
    } catch (e: any) {
      clearTimeout(timeoutId);
      console.log('[CreateVenue] error', JSON.stringify({ code: e?.code || e?.name, msg: e?.message || String(e) }));
      showError(`Could not create project: ${e?.message || 'Missing or insufficient permissions.'}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleBackToLogin() {
    try {
      await signOut(getAuth());
      console.log('[CreateVenue] back-to-login signOut ok');
    } catch {}
  }

  return (
    <View style={{ flex: 1, padding: 16, backgroundColor: c.oat }}>
      <Text style={{ fontSize: 22, fontWeight: '800', color: c.navy, fontFamily: theme.fontTitle, marginBottom: 12 }}>
        Create a new project
      </Text>
      <Text style={{ color: c.slateMid, fontFamily: theme.fontBody, lineHeight: 20 }}>
        Enter a name and choose what kind of project this is. We'll add default departments and areas; you can edit them later in Settings.
      </Text>

      <Text style={{ color: c.missionSlate, marginTop: 20, marginBottom: 10, fontSize: 15, fontFamily: theme.fontBodySemiBold }}>
        What kind of project?
      </Text>

      <View style={styles.typeRow}>
        <TouchableOpacity
          onPress={() => setProjectType('venue')}
          disabled={busy}
          style={[
            styles.typeCard,
            {
              backgroundColor: projectType === 'venue' ? c.deepBlue : c.surface,
              borderColor: projectType === 'venue' ? c.deepBlue : c.border,
            },
          ]}
        >
          <Text style={{ fontSize: 28, marginBottom: 6 }}>🍺</Text>
          <Text style={[
            styles.typeLabel,
            { fontFamily: theme.fontBodySemiBold, color: projectType === 'venue' ? '#ffffff' : c.missionSlate },
          ]}>
            Venue
          </Text>
          <Text style={[
            { fontSize: 12, textAlign: 'center', marginTop: 4, fontFamily: theme.fontBody },
            { color: projectType === 'venue' ? 'rgba(255,255,255,0.8)' : c.slateMid },
          ]}>
            Bar, restaurant, café, hotel
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => setProjectType('festival')}
          disabled={busy}
          style={[
            styles.typeCard,
            {
              backgroundColor: projectType === 'festival' ? c.deepBlue : c.surface,
              borderColor: projectType === 'festival' ? c.deepBlue : c.border,
            },
          ]}
        >
          <Text style={{ fontSize: 28, marginBottom: 6 }}>🎪</Text>
          <Text style={[
            styles.typeLabel,
            { fontFamily: theme.fontBodySemiBold, color: projectType === 'festival' ? '#ffffff' : c.missionSlate },
          ]}>
            Festival
          </Text>
          <Text style={[
            { fontSize: 12, textAlign: 'center', marginTop: 4, fontFamily: theme.fontBody },
            { color: projectType === 'festival' ? 'rgba(255,255,255,0.8)' : c.slateMid },
          ]}>
            Single day, multi-day, or seasonal event
          </Text>
        </TouchableOpacity>
      </View>

      <Text style={{ color: c.missionSlate, marginTop: 20, marginBottom: 10, fontSize: 15, fontFamily: theme.fontBodySemiBold }}>
        Country
      </Text>

      <View style={styles.chipRow}>
        <TouchableOpacity
          onPress={() => setCountry('NZ')}
          disabled={busy}
          style={[
            styles.chip,
            {
              backgroundColor: country === 'NZ' ? c.deepBlue : c.surface,
              borderColor: country === 'NZ' ? c.deepBlue : c.border,
            },
          ]}
        >
          <Text style={{ fontFamily: theme.fontBodySemiBold, fontSize: 14, color: country === 'NZ' ? c.primaryText : c.missionSlate }}>
            New Zealand
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => setCountry('AU')}
          disabled={busy}
          style={[
            styles.chip,
            {
              backgroundColor: country === 'AU' ? c.deepBlue : c.surface,
              borderColor: country === 'AU' ? c.deepBlue : c.border,
            },
          ]}
        >
          <Text style={{ fontFamily: theme.fontBodySemiBold, fontSize: 14, color: country === 'AU' ? c.primaryText : c.missionSlate }}>
            Australia
          </Text>
        </TouchableOpacity>
      </View>

      <Text style={{ color: c.missionSlate, marginTop: 20, marginBottom: 10, fontSize: 15, fontFamily: theme.fontBodySemiBold }}>
        {projectType === 'festival' ? 'Festival name' : projectType === 'venue' ? 'Venue name' : 'Project name'}
      </Text>

      <TextInput
        placeholder={
          projectType === 'festival' ? 'e.g. Shipwrecked 2027'
          : projectType === 'venue' ? 'e.g. Harbourside Bar'
          : 'e.g. Harbourside Bar or Shipwrecked 2027'
        }
        placeholderTextColor={c.slateMid}
        value={name}
        onChangeText={setName}
        style={{
          backgroundColor: c.surface,
          color: c.navy,
          paddingHorizontal: 12,
          paddingVertical: 12,
          borderRadius: 10,
          borderWidth: 1,
          borderColor: c.border,
          marginBottom: 20,
          fontFamily: theme.fontBody,
          fontSize: 15,
        }}
        autoCapitalize="words"
        autoFocus
        editable={!busy}
      />

      <TouchableOpacity
        onPress={handleCreate}
        disabled={busy}
        style={{
          backgroundColor: busy ? c.border : c.deepBlue,
          paddingVertical: 14,
          borderRadius: 10,
          alignItems: 'center',
        }}
      >
        {busy
          ? <ActivityIndicator color={c.surface} />
          : <Text style={{ color: c.surface, fontWeight: '700', fontSize: 15, fontFamily: theme.fontBodySemiBold }}>Create project</Text>}
      </TouchableOpacity>

      <TouchableOpacity
        onPress={handleBackToLogin}
        disabled={busy}
        style={{
          marginTop: 24,
          paddingVertical: 10,
          borderRadius: 10,
          alignItems: 'center',
          borderColor: c.border,
          borderWidth: 1,
        }}
      >
        <Text style={{ color: c.slateMid, fontFamily: theme.fontBody }}>Back to Login</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = {
  typeRow: {
    flexDirection: 'row' as const,
    gap: 12,
  },
  typeCard: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 2,
    padding: 16,
    alignItems: 'center' as const,
  },
  typeLabel: {
    fontSize: 15,
  },
  chipRow: {
    flexDirection: 'row' as const,
    gap: 10,
  },
  chip: {
    flex: 1,
    borderRadius: 999,
    borderWidth: 2,
    paddingVertical: 10,
    alignItems: 'center' as const,
  },
};
