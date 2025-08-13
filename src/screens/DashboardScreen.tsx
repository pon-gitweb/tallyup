import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { auth } from 'src/services/firebase';
import { signOut } from 'firebase/auth';
import { useNavigation } from '@react-navigation/native';
import { ensureVenueAndMembership } from 'src/services/ensureMembership';
import { DEV_DEFAULT_VENUE_ID } from 'src/config/devAuth';

export default function DashboardScreen() {
  const nav = useNavigation();

  React.useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (uid) {
      ensureVenueAndMembership(DEV_DEFAULT_VENUE_ID, uid)
        .catch((e) => console.warn('[Dashboard] ensureVenueAndMembership error', e));
    }
  }, []);

  const onSetupVenue = () => nav.navigate('SetupVenue' as never);
  const onSignOut = async () => { await signOut(auth); };

  return (
    <View style={{ flex:1, padding: 20 }}>
      <Text style={{ fontSize: 22, fontWeight: '700', marginBottom: 16 }}>Dashboard</Text>
      <View style={{ padding:16, borderWidth:1, borderColor:'#ddd', borderRadius:12, marginBottom:16 }}>
        <Text style={{ fontWeight:'600', marginBottom:8 }}>Welcome!</Text>
        <Text style={{ color:'#555' }}>Start by setting up your venue details and default departments/areas.</Text>
        <TouchableOpacity
          onPress={onSetupVenue}
          style={{ backgroundColor:'#0984e3', padding:12, borderRadius:8, alignItems:'center', marginTop:12 }}>
          <Text style={{ color:'#fff', fontWeight:'700' }}>Set up your venue</Text>
        </TouchableOpacity>
      </View>
      <TouchableOpacity
        onPress={onSignOut}
        style={{ backgroundColor:'#d63031', padding:12, borderRadius:8, alignItems:'center', alignSelf:'flex-start' }}>
        <Text style={{ color:'#fff', fontWeight:'700' }}>Sign Out</Text>
      </TouchableOpacity>
    </View>
  );
}
