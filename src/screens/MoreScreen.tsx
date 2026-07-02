// @ts-nocheck
import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { getFirestore, doc, getDoc } from 'firebase/firestore';
import { useColours, useTheme } from '../context/ThemeContext';
import { useToast } from '../components/common/Toast';
import { useConfirmModal } from '../components/common/useConfirmModal';
import { useVenueId, useVenue } from '../context/VenueProvider';
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
      <Text style={{ fontSize: 20, color: c.deepBlue, fontWeight: '300' }}>›</Text>
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
  const { theme } = useTheme();
  const { showSuccess, showError, showInfo } = useToast();
  const { confirm, modal } = useConfirmModal();
  const venueId = useVenueId();
  const { user } = useVenue();
  const [isManager, setIsManager] = useState(false);

  useEffect(() => {
    if (!venueId || !user?.uid) return;
    const db = getFirestore();
    (async () => {
      try {
        const venueSnap = await getDoc(doc(db, 'venues', venueId));
        if (venueSnap.data()?.ownerUid === user.uid) { setIsManager(true); return; }
        const memberSnap = await getDoc(doc(db, 'venues', venueId, 'members', user.uid));
        const role = memberSnap.data()?.role;
        setIsManager(role === 'manager' || role === 'owner');
      } catch {}
    })();
  }, [venueId, user?.uid]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.background }}>
      {modal}
      {/* Header */}
      <View style={{
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12,
        justifyContent: 'space-between',
      }}>
        <Text style={{ fontSize: 24, fontWeight: '800', color: c.navy }}>More</Text>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <TouchableOpacity onPress={openIzzy} style={{ padding: 4 }}>
            <Text style={{ color: c.deepBlue, fontSize: 18, fontWeight: '600' }}>✦</Text>
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
          <Row icon="📋" label="Stocktake History" onPress={() => nav.navigate('StocktakeHistory')} />
          {isManager && (
            <TouchableOpacity
              onPress={() => nav.navigate('POSConnection')}
              activeOpacity={0.7}
              style={{
                flexDirection: 'row', alignItems: 'center',
                paddingVertical: 14, paddingHorizontal: 16,
                borderBottomWidth: 1, borderBottomColor: c.border,
              }}
            >
              <Text style={{ fontSize: 18, marginRight: 12, width: 26 }}>🔌</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 15, color: c.navy, fontWeight: '500' }}>POS connection</Text>
                <Text style={{ fontSize: 12, color: c.textSecondary, marginTop: 2 }}>
                  Connect your venue's POS system
                </Text>
              </View>
              <Text style={{ fontSize: 20, color: c.deepBlue, fontWeight: '300' }}>›</Text>
            </TouchableOpacity>
          )}
          {isManager && (
            <TouchableOpacity
              onPress={() => nav.navigate('POSMapping')}
              activeOpacity={0.7}
              style={{
                flexDirection: 'row', alignItems: 'center',
                paddingVertical: 14, paddingHorizontal: 16,
                borderBottomWidth: 1, borderBottomColor: c.border,
              }}
            >
              <Text style={{ fontSize: 18, marginRight: 12, width: 26 }}>🖥️</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 15, color: c.navy, fontWeight: '500' }}>POS product mapping</Text>
                <Text style={{ fontSize: 12, color: c.textSecondary, marginTop: 2 }}>
                  Match your POS sale items to stock products
                </Text>
              </View>
              <Text style={{ fontSize: 20, color: c.deepBlue, fontWeight: '300' }}>›</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            onPress={() => nav.navigate('SalesImport')}
            activeOpacity={0.7}
            style={{
              flexDirection: 'row', alignItems: 'center',
              paddingVertical: 14, paddingHorizontal: 16,
              borderBottomWidth: 1, borderBottomColor: c.border,
            }}
          >
            <Text style={{ fontSize: 18, marginRight: 12, width: 26 }}>📊</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 15, color: c.navy, fontWeight: '500' }}>Sales Report Import</Text>
              <Text style={{ fontSize: 12, color: c.textSecondary, marginTop: 2 }}>
                Import sales CSV or PDF when no POS is connected
              </Text>
            </View>
            <Text style={{ fontSize: 20, color: c.deepBlue, fontWeight: '300' }}>›</Text>
          </TouchableOpacity>
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
              <Text style={{ fontSize: 15, color: c.navy, fontWeight: '700' }}>CraftIt — Recipe costing</Text>
              <Text style={{ fontSize: 12, color: c.textSecondary, marginTop: 2, lineHeight: 17 }}>
                Build recipes, calculate COGS, set selling prices
              </Text>
            </View>
            <Text style={{ fontSize: 20, color: c.deepBlue, fontWeight: '300' }}>›</Text>
          </TouchableOpacity>
        </View>

        <View style={{ backgroundColor: c.surface, borderRadius: 12, marginHorizontal: 16, marginTop: 12, borderWidth: 1, borderColor: c.border, overflow: 'hidden' }}>
          <SectionHeader title="Team" />
          <Row icon="👥" label="Team Members" onPress={() => nav.navigate('TeamMembers')} />
          <TouchableOpacity
            onPress={() => nav.navigate('VenueList')}
            activeOpacity={0.7}
            style={{
              flexDirection: 'row', alignItems: 'center',
              paddingVertical: 14, paddingHorizontal: 16,
              borderBottomWidth: 1, borderBottomColor: c.border,
            }}
          >
            <Text style={{ fontSize: 18, marginRight: 12, width: 26 }}>🏢</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 15, color: c.navy, fontWeight: '500' }}>My Projects</Text>
              <Text style={{ fontSize: 12, color: c.textSecondary, marginTop: 2 }}>
                Switch between venues and festivals
              </Text>
            </View>
            <Text style={{ fontSize: 20, color: c.deepBlue, fontWeight: '300' }}>›</Text>
          </TouchableOpacity>
          <Row icon="⚙️" label="Settings"     onPress={() => nav.navigate('Settings')} />
        </View>

        <View style={{ backgroundColor: c.surface, borderRadius: 12, marginHorizontal: 16, marginTop: 12, borderWidth: 1, borderColor: c.border, overflow: 'hidden' }}>
          <SectionHeader title="Help" />
          <Row icon="✦"  label="Ask Izzy"     onPress={openIzzy} />
          <Row icon="ℹ️" label="Setup Guide"  onPress={() => nav.navigate('SetupGuide')} />
          <Row icon="⚖️" label="Bluetooth Scale" onPress={() => nav.navigate('ScaleSettings')} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
