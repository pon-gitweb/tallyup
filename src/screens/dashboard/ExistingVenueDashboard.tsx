import React from 'react';
import { View, Text, TouchableOpacity, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { auth } from 'src/services/firebase';
import { DEV_DEFAULT_VENUE_ID } from 'src/config/devAuth';
import { getUserVenueId, setUserVenueId } from 'src/services/userProfile';
import { isMember, joinOpenSignup, createJoinAndSeedDevVenue } from 'src/services/venues';
import { observeActiveSession, ensureActiveSession, setLastLocation, ActiveSession } from 'src/services/activeTake';

export default function ExistingVenueDashboard() {
  const nav = useNavigation();
  const uid = auth.currentUser?.uid || '';

  const [loading, setLoading] = React.useState(true);
  const [venueId, setVenueId] = React.useState<string | null>(null);
  const [member, setMember] = React.useState<boolean>(false);
  const [session, setSession] = React.useState<ActiveSession | null>(null);

  // Resolve venue + membership
  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const profileVenue = await getUserVenueId(uid);
        const vId = profileVenue || DEV_DEFAULT_VENUE_ID || null;
        if (!alive) return;
        setVenueId(vId);
        if (vId) {
          const m = await isMember(vId, uid).catch(() => false);
          if (!alive) return;
          setMember(m);
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [uid]);

  // Watch venue-level active session (for button label/badge)
  React.useEffect(() => {
    if (!venueId || !member) return;
    const unsub = observeActiveSession(venueId, setSession, (e) => console.warn('[Dashboard] session observe error', e));
    return () => unsub && unsub();
  }, [venueId, member]);

  const onJoin = async () => {
    if (!venueId) return;
    try {
      await joinOpenSignup(venueId, uid);
      setMember(true);
      Alert.alert('Joined', 'You now have access to this venue.');
    } catch (e: any) {
      console.warn('[ExistingVenueDashboard] join error', e);
      Alert.alert('Join failed', e?.message ?? 'If this is a dev venue, set config.openSignup = true on the venue doc.');
    }
  };

  const onCreateNewDevVenue = async () => {
    try {
      const newId = await createJoinAndSeedDevVenue(uid);
      await setUserVenueId(uid, newId);
      setVenueId(newId);
      setMember(true);
      Alert.alert('Venue ready', 'New dev venue created, joined, and seeded.');
    } catch (e: any) {
      console.warn('[ExistingVenueDashboard] create venue error', e);
      Alert.alert('Create failed', e?.message ?? 'Could not create dev venue.');
    }
  };

  const onPrimary = async () => {
    if (!venueId) {
      Alert.alert('No venue', 'Select or create a venue first.');
      return;
    }
    if (!member) {
      Alert.alert('Not a member', 'Join the venue to continue.');
      return;
    }
    // Always enter via Departments hub (not Areas/Inventory)
    await ensureActiveSession(venueId);
    await setLastLocation(venueId, { lastDepartmentId: null, lastAreaId: null });
    nav.navigate('DepartmentSelection' as never, { venueId } as never);
  };

  if (loading) {
    return (
      <View style={{ flex:1, alignItems:'center', justifyContent:'center' }}>
        <Text>Loading venue…</Text>
      </View>
    );
  }

  if (!venueId) {
    return (
      <View style={{ flex:1, padding:20, justifyContent:'center' }}>
        <Text style={{ fontSize:18, marginBottom:16 }}>No venue selected.</Text>
        <TouchableOpacity onPress={onCreateNewDevVenue}
          style={{ backgroundColor:'#2ecc71', padding:14, borderRadius:10, alignItems:'center' }}>
          <Text style={{ color:'#fff', fontWeight:'700' }}>Create New Dev Venue</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!member) {
    return (
      <View style={{ flex:1, padding:20, justifyContent:'center' }}>
        <Text style={{ fontSize:18, marginBottom:10 }}>You are not a member of:</Text>
        <Text style={{ color:'#555', marginBottom:16 }}>{venueId}</Text>
        <TouchableOpacity onPress={onJoin}
          style={{ backgroundColor:'#2ecc71', padding:14, borderRadius:10, alignItems:'center', marginBottom:12 }}>
          <Text style={{ color:'#fff', fontWeight:'700' }}>Join Venue</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onCreateNewDevVenue}
          style={{ backgroundColor:'#6c5ce7', padding:14, borderRadius:10, alignItems:'center' }}>
          <Text style={{ color:'#fff', fontWeight:'700' }}>Create New Dev Venue</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const isActive = session?.status === 'active';

  return (
    <View style={{ flex:1, padding:20 }}>
      <Text style={{ fontSize:22, fontWeight:'700', marginBottom:10 }}>Dashboard — Venue {venueId.slice(0,8)}…</Text>
      {isActive && (
        <View style={{ paddingVertical:4, marginBottom:8 }}>
          <Text style={{ color:'#e17055' }}>Active stock take in progress</Text>
        </View>
      )}

      <TouchableOpacity
        onPress={onPrimary}
        style={{ backgroundColor: isActive ? '#e17055' : '#2d3436', padding:14, borderRadius:10, alignItems:'center', marginBottom:12 }}>
        <Text style={{ color:'#fff', fontWeight:'700' }}>
          {isActive ? 'Return to Active Stock Take' : 'Start Stock Take'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        onPress={() => Alert.alert('Settings', 'Settings stub')}
        style={{ backgroundColor:'#0984e3', padding:14, borderRadius:10, alignItems:'center', marginBottom:12 }}>
        <Text style={{ color:'#fff', fontWeight:'700' }}>Settings</Text>
      </TouchableOpacity>

      <TouchableOpacity
        onPress={() => Alert.alert('Reports', 'Reports stub')}
        style={{ backgroundColor:'#6c5ce7', padding:14, borderRadius:10, alignItems:'center' }}>
        <Text style={{ color:'#fff', fontWeight:'700' }}>Reports</Text>
      </TouchableOpacity>
    </View>
  );
}
