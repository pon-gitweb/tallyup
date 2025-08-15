import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert, Image } from 'react-native';
import { useNavigation } from '@react-navigation/native';

export default function SettingsScreen() {
  const nav = useNavigation();

  const Card = ({ title, desc, onPress }: { title: string; desc: string; onPress?: () => void }) => (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={onPress}
      style={{
        backgroundColor: '#fff',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#eaeaea',
        padding: 14,
        marginBottom: 12,
      }}
    >
      <Text style={{ fontWeight: '700', marginBottom: 4 }}>{title}</Text>
      <Text style={{ color: '#666' }}>{desc}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={{ flex: 1, padding: 16, backgroundColor: '#f8f9fa' }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <Text style={{ fontSize: 22, fontWeight: '800', marginBottom: 12 }}>Settings</Text>

        <Card
          title="Branding"
          desc="Upload logo, choose a color theme (light, dark, brand)."
          onPress={() => Alert.alert('Branding', 'Branding stub — will be implemented in native stage.')}
        />

        <Card
          title="Venue Profile"
          desc="Set venue name, address, contact. (Defaults to '<email> Venue' until set.)"
          onPress={() => Alert.alert('Venue Profile', 'Venue profile stub — will connect to venues/{venueId}.')}
        />

        <Card
          title="Departments"
          desc="Enable/disable Bar, Kitchen, etc. Only ACTIVE departments count toward venue completion."
          onPress={() => Alert.alert('Departments', 'Departments stub — will toggle departments.active.')}
        />

        <Card
          title="Permissions"
          desc="Manage members and roles. (Admins can reopen cycles and change structure.)"
          onPress={() => Alert.alert('Permissions', 'Permissions stub — will manage venues/{venueId}/members.')}
        />

        <Card
          title="Data & Export"
          desc="Export latest counts and historical sessions for your accountant."
          onPress={() => Alert.alert('Data & Export', 'Export stub — will generate CSV/PDF in native stage.')}
        />
      </ScrollView>
    </View>
  );
}
