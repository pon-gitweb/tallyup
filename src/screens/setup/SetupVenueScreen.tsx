import React from 'react';
import { View, Text, TouchableOpacity, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
// Optional: import { seedVenueIfEmpty } from 'src/services/seedDefaults';

export default function SetupVenueScreen() {
  const nav = useNavigation();

  const onContinue = async () => {
    // Later: run a venue creation flow or seed defaults.
    // await seedVenueIfEmpty('demoVenue');
    Alert.alert('Setup', 'Venue setup placeholder complete.');
    nav.goBack();
  };

  return (
    <View style={{ flex:1, padding:20, justifyContent:'center' }}>
      <Text style={{ fontSize:22, fontWeight:'700', marginBottom:12 }}>Setup your venue</Text>
      <Text style={{ color:'#555', marginBottom:16 }}>
        This is a placeholder. Next step: create your venue and default departments/areas.
      </Text>
      <TouchableOpacity
        onPress={onContinue}
        style={{ backgroundColor:'#2ecc71', padding:14, borderRadius:10, alignItems:'center' }}>
        <Text style={{ color:'#fff', fontWeight:'700' }}>Continue</Text>
      </TouchableOpacity>
    </View>
  );
}
