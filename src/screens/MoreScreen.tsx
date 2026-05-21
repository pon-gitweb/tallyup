// @ts-nocheck
import React from 'react';
import {
  View, Text, TouchableOpacity, ScrollView,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useColours } from '../context/ThemeContext';
import IdentityBadge from '../components/IdentityBadge';
import { openIzzy } from '../components/IzzyAssistant';

type RowProps = { label: string; onPress: () => void; icon?: string };

function Row({ label, onPress, icon }: RowProps) {
  const c = useColours();
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={{
        flexDirection: 'row', alignItems: 'center',
        paddingVertical: 14, paddingHorizontal: 16,
        borderBottomWidth: 1, borderBottomColor: c.border,
      }}
    >
      {icon ? <Text style={{ fontSize: 18, marginRight: 12, width: 26 }}>{icon}</Text> : null}
      <Text style={{ flex: 1, fontSize: 15, color: c.navy, fontWeight: '500' }}>{label}</Text>
      <Text style={{ fontSize: 20, color: '#1b4f72', fontWeight: '300' }}>›</Text>
    </TouchableOpacity>
  );
}

function SectionHeader({ title }: { title: string }) {
  const c = useColours();
  return (
    <Text style={{
      fontSize: 11, fontWeight: '800', color: c.textSecondary,
      textTransform: 'uppercase', letterSpacing: 0.8,
      paddingHorizontal: 16, paddingTop: 20, paddingBottom: 6,
    }}>
      {title}
    </Text>
  );
}

export default function MoreScreen() {
  const nav = useNavigation<any>();
  const c = useColours();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.background }}>
      {/* Header */}
      <View style={{
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12,
        justifyContent: 'space-between',
      }}>
        <Text style={{ fontSize: 24, fontWeight: '800', color: c.navy }}>More</Text>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <TouchableOpacity onPress={openIzzy} style={{ padding: 4 }}>
            <Text style={{ color: '#1b4f72', fontSize: 18, fontWeight: '600' }}>✦</Text>
          </TouchableOpacity>
          <IdentityBadge />
        </View>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <View style={{ backgroundColor: c.surface, borderRadius: 12, marginHorizontal: 16, borderWidth: 1, borderColor: c.border, overflow: 'hidden' }}>
          <SectionHeader title="Inventory" />
          <Row icon="📦" label="Products"  onPress={() => nav.navigate('Products')} />
          <Row icon="🚚" label="Suppliers" onPress={() => nav.navigate('Suppliers')} />
          <Row icon="📋" label="Orders"    onPress={() => nav.navigate('Orders')} />
          <Row icon="🛒" label="Suggested Orders" onPress={() => nav.navigate('SuggestedOrders')} />
          <Row icon="📋" label="Stocktake History" onPress={() => nav.navigate('StocktakeHistory')} />
          <Row icon="📊" label="Stock Control" onPress={() => nav.navigate('StockControl')} />
        </View>

        <View style={{ backgroundColor: c.surface, borderRadius: 12, marginHorizontal: 16, marginTop: 12, borderWidth: 1, borderColor: c.border, overflow: 'hidden' }}>
          <SectionHeader title="RECIPES" />
          <TouchableOpacity
            onPress={() => nav.navigate('CraftUp')}
            activeOpacity={0.7}
            style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16 }}
          >
            <Text style={{ fontSize: 18, marginRight: 12, width: 26 }}>🍹</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 15, color: c.navy, fontWeight: '700' }}>CraftUp — Recipe costing</Text>
              <Text style={{ fontSize: 12, color: c.textSecondary, marginTop: 2, lineHeight: 17 }}>
                Build recipes, calculate COGS, set selling prices
              </Text>
            </View>
            <Text style={{ fontSize: 20, color: '#1b4f72', fontWeight: '300' }}>›</Text>
          </TouchableOpacity>
        </View>

        <View style={{ backgroundColor: c.surface, borderRadius: 12, marginHorizontal: 16, marginTop: 12, borderWidth: 1, borderColor: c.border, overflow: 'hidden' }}>
          <SectionHeader title="Team" />
          <Row icon="👥" label="Team Members" onPress={() => nav.navigate('TeamMembers')} />
          <Row icon="⚙️" label="Settings"     onPress={() => nav.navigate('Settings')} />
        </View>

        <View style={{ backgroundColor: c.surface, borderRadius: 12, marginHorizontal: 16, marginTop: 12, borderWidth: 1, borderColor: c.border, overflow: 'hidden' }}>
          <SectionHeader title="Help" />
          <Row icon="✦"  label="Ask Izzy"     onPress={openIzzy} />
          <Row icon="ℹ️" label="Setup Guide"  onPress={() => nav.navigate('SetupGuide')} />
          <Row icon="⚖️" label="Bluetooth Scale" onPress={() => nav.navigate('ScaleSettings')} />
          <Row icon="🎨" label="Appearance"   onPress={() => nav.navigate('Appearance')} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
