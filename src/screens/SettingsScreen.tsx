import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, TextInput } from 'react-native';
import { signOutAll } from '../services/auth';
import { DEV_VENUE_ID, DEV_EMAIL } from '../config/dev';
import { attachSelfToVenue, ensureDevMembership, getCurrentVenueForUser } from '../services/devBootstrap';

export default function SettingsScreen() {
  const [uid, setUid] = useState<string>('');
  const [email, setEmail] = useState<string | null>(null);
  const [venueId, setVenueId] = useState<string | null>(null);
  const [attachId, setAttachId] = useState<string>('');
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    try {
      const v = await getCurrentVenueForUser();
      setUid(v.uid);
      setEmail(v.email ?? null);
      setVenueId(v.venueId ?? null);
    } catch (e: any) {
      Alert.alert('Load failed', e?.message ?? 'Unknown error');
    }
  };

  useEffect(() => { void reload(); }, []);

  const onReattachDev = async () => {
    try {
      setBusy(true);
      const { venueId } = await ensureDevMembership();
      setVenueId(venueId);
      Alert.alert('Attached', `You are attached to ${venueId}.`);
    } catch (e: any) {
      Alert.alert('Attach failed', e?.message ?? 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  const onAttachCustom = async () => {
    const target = attachId.trim();
    if (!target) { Alert.alert('Missing venue ID', 'Enter a venue ID to attach.'); return; }
    try {
      setBusy(true);
      const { venueId } = await attachSelfToVenue(target);
      setVenueId(venueId);
      setAttachId('');
      Alert.alert('Attached', `You are attached to ${venueId}.`);
    } catch (e: any) {
      Alert.alert('Attach failed', e?.message ?? 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  const onSignOut = async () => {
    try {
      setBusy(true);
      await signOutAll(); // auth observer will route to AuthEntry
    } catch (e: any) {
      Alert.alert('Sign out failed', e?.message ?? 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={S.c}>
      <Text style={S.h1}>Settings</Text>

      <View style={S.card}>
        <Text style={S.cardTitle}>Account</Text>
        <Text style={S.p}>UID: {uid || '—'}</Text>
        <Text style={S.p}>Email: {email || '—'}</Text>
        <Text style={S.p}>Current venue: {venueId || '—'}</Text>
      </View>

      <View style={S.card}>
        <Text style={S.cardTitle}>Dev Utilities</Text>
        <Text style={S.p}>Pinned dev account: {DEV_EMAIL}</Text>
        <Text style={S.p}>Pinned dev venue: {DEV_VENUE_ID}</Text>

        <TouchableOpacity style={[S.btn, busy && S.btnDisabled]} onPress={onReattachDev} disabled={busy}>
          <Text style={S.btnText}>{busy ? 'Working…' : 'Reattach to Dev Venue'}</Text>
        </TouchableOpacity>

        <View style={S.row}>
          <TextInput
            style={S.input}
            placeholder="Enter venue ID (dev)"
            value={attachId}
            onChangeText={setAttachId}
            autoCapitalize="none"
            editable={!busy}
          />
          <TouchableOpacity style={[S.btnSmall, busy && S.btnDisabled]} onPress={onAttachCustom} disabled={busy}>
            <Text style={S.btnTextSmall}>Attach me</Text>
          </TouchableOpacity>
        </View>

        <Text style={S.note}>
          Note: “Attach me” is a dev-only shortcut that updates your /users profile to the target venue and creates your membership there, matching current rules.
        </Text>
      </View>

      <TouchableOpacity style={[S.btnDanger, busy && S.btnDisabled]} onPress={onSignOut} disabled={busy}>
        <Text style={S.btnText}>Sign out</Text>
      </TouchableOpacity>
    </View>
  );
}

const S = StyleSheet.create({
  c:{ flex:1, padding:16, backgroundColor:'#fff' },
  h1:{ fontSize:22, fontWeight:'700', marginBottom:12 },
  card:{ padding:12, backgroundColor:'#F3F4F6', borderRadius:10, marginBottom:12 },
  cardTitle:{ fontWeight:'700', marginBottom:6 },
  p:{ color:'#333' },
  row:{ flexDirection:'row', alignItems:'center', marginTop:10 },
  input:{ flex:1, borderWidth:1, borderColor:'#ddd', borderRadius:10, padding:10, backgroundColor:'#fff' },
  btn:{ backgroundColor:'#0A84FF', padding:12, borderRadius:10, alignItems:'center', marginTop:10 },
  btnDisabled:{ opacity:0.6 },
  btnText:{ color:'#fff', fontWeight:'700' },
  btnSmall:{ marginLeft:8, backgroundColor:'#0A84FF', paddingVertical:12, paddingHorizontal:14, borderRadius:10, alignItems:'center' },
  btnTextSmall:{ color:'#fff', fontWeight:'700' },
  note:{ color:'#555', fontSize:12, marginTop:8 },
  btnDanger:{ backgroundColor:'#EF4444', padding:14, borderRadius:10, alignItems:'center', marginTop:16 },
});
