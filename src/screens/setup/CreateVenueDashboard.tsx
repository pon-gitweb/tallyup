import React from 'react';
import { View, Text, TouchableOpacity, Alert } from 'react-native';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../../services/firebase';
import { useNavigation } from '@react-navigation/native';

export default function CreateVenueDashboard() {
  const nav = useNavigation();

  const onCreateVenue = async () => {
    try {
      // Minimal venue with openSignup=true so your other devices can join in dev
      const venueId = crypto.randomUUID();
      await setDoc(doc(db, `venues/${venueId}`), {
        name: 'My New Venue',
        createdAt: serverTimestamp(),
        config: { openSignup: true }
      });
      Alert.alert('Venue created', 'Venue is ready. Heading to the dashboard.');
      nav.reset({ index: 0, routes: [{ name: 'Dashboard' as never }] });
    } catch (e: any) {
      console.warn('[CreateVenueDashboard] create error', e);
      Alert.alert('Failed to create venue', e?.message ?? 'Please try again.');
    }
  };

  return (
    <View style={{ flex:1, padding:20, justifyContent:'center' }}>
      <Text style={{ fontSize:22, fontWeight:'700', marginBottom:12 }}>Set up your venue</Text>
      <Text style={{ color:'#555', marginBottom:16 }}>
        Create your venue and start stock takes. (This is a dev-friendly flow; we keep openSignup on for easy joining.)
      </Text>
      <TouchableOpacity
        onPress={onCreateVenue}
        style={{ backgroundColor:'#2ecc71', padding:14, borderRadius:10, alignItems:'center' }}>
        <Text style={{ color:'#fff', fontWeight:'700' }}>Create Venue</Text>
      </TouchableOpacity>
    </View>
  );
}
