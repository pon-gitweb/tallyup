import React from 'react';
import { View, Button, Text } from 'react-native';
import { useNavigation } from '@react-navigation/native';

export default function SetupEntry() {
  const nav = useNavigation<any>();
  return (
    <View style={{ marginTop: 16 }}>
      <Text style={{ fontWeight: '600', marginBottom: 8 }}>Venue Setup</Text>
      <Button title="Open Setup Wizard" onPress={() => nav.navigate('SetupWizard')} />
    </View>
  );
}
