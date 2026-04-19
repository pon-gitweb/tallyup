// @ts-nocheck
/**
 * XeroScreen — Settings → Xero Integration
 * Connects venue to Xero via OAuth2.
 * Structure ready — activation requires Xero app registration.
 * Register at developer.xero.com
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, ScrollView, Text, TouchableOpacity, View, ActivityIndicator } from 'react-native';
import { XeroService, XeroConnection } from '../../services/integrations/xero/XeroService';
import { useVenueId } from '../../context/VenueProvider';
import { withErrorBoundary } from '../../components/ErrorCatcher';
import { useColours } from '../../context/ThemeContext';

function XeroScreen() {
  const venueId = useVenueId();
  const themeColours = useColours();
  const [connection, setConnection] = useState<XeroConnection>({ status: 'not_connected' });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!venueId) return;
    setLoading(true);
    const conn = await XeroService.getConnection(venueId);
    setConnection(conn);
    setLoading(false);
  }, [venueId]);

  useEffect(() => { load(); }, [load]);

  const onConnect = useCallback(async () => {
    if (!venueId) return;
    Alert.alert(
      'Connect to Xero',
      'You will be taken to Xero to authorise Hosti-Stock. Once connected, purchase orders and invoices will sync automatically.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Connect', onPress: async () => {
          setBusy(true);
          try {
            await XeroService.startOAuthFlow(venueId);
          } catch (e: any) {
            Alert.alert('Connection failed', e?.message || 'Could not open Xero. Please try again.');
          }
          setBusy(false);
        }},
      ]
    );
  }, [venueId]);

  const onDisconnect = useCallback(async () => {
    if (!venueId) return;
    Alert.alert(
      'Disconnect Xero',
      'This will stop syncing with Xero. Your existing Xero data will not be affected.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Disconnect', style: 'destructive', onPress: async () => {
          setBusy(true);
          await XeroService.disconnect(venueId);
          await load();
          setBusy(false);
        }},
      ]
    );
  }, [venueId, load]);

  const isConnected = connection.status === 'connected';

  return (
    <ScrollView style={{ flex: 1, backgroundColor: themeColours.background }} contentContainerStyle={{ padding: 16, gap: 16 }}>

      {/* Header */}
      <View style={{ backgroundColor: '#13B5EA', borderRadius: 16, padding: 20 }}>
        <Text style={{ fontSize: 28, fontWeight: '900', color: '#fff' }}>Xero</Text>
        <Text style={{ color: 'rgba(255,255,255,0.85)', marginTop: 4, fontSize: 14 }}>
          Connect your Xero account to automatically sync purchase orders and invoices.
        </Text>
      </View>

      {/* Status */}
      {loading ? (
        <ActivityIndicator color={themeColours.accent} />
      ) : (
        <View style={{
          backgroundColor: themeColours.surface, borderRadius: 14, padding: 16,
          borderWidth: 1, borderColor: isConnected ? '#BBF7D0' : themeColours.border,
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{
              width: 12, height: 12, borderRadius: 6,
              backgroundColor: isConnected ? themeColours.success : '#9CA3AF',
            }} />
            <Text style={{ fontWeight: '900', color: themeColours.text, fontSize: 16 }}>
              {isConnected ? 'Connected' : 'Not connected'}
            </Text>
          </View>
          {isConnected && connection.tenantName && (
            <Text style={{ color: themeColours.textSecondary, marginTop: 4, fontSize: 13 }}>
              Organisation: {connection.tenantName}
            </Text>
          )}
          {isConnected && connection.connectedAt && (
            <Text style={{ color: themeColours.textSecondary, fontSize: 12, marginTop: 2 }}>
              Connected: {new Date(connection.connectedAt).toLocaleDateString('en-NZ')}
            </Text>
          )}
        </View>
      )}

      {/* What syncs */}
      <View style={{ backgroundColor: themeColours.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: themeColours.border }}>
        <Text style={{ fontWeight: '900', color: themeColours.text, marginBottom: 12 }}>What syncs with Xero</Text>
        {[
          { icon: '📋', title: 'Purchase Orders', desc: 'Orders placed in Hosti-Stock appear as Draft Bills in Xero' },
          { icon: '🧾', title: 'Received Invoices', desc: 'Approved invoices are pushed to Xero as Approved Bills' },
          { icon: '🏢', title: 'Supplier Contacts', desc: 'Your Xero contacts are available when setting up suppliers' },
        ].map((item, i) => (
          <View key={i} style={{ flexDirection: 'row', gap: 12, marginBottom: i < 2 ? 14 : 0 }}>
            <Text style={{ fontSize: 20 }}>{item.icon}</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '800', color: themeColours.text }}>{item.title}</Text>
              <Text style={{ color: themeColours.textSecondary, fontSize: 13, marginTop: 2 }}>{item.desc}</Text>
            </View>
            <View style={{
              backgroundColor: isConnected ? '#F0FDF4' : '#F9FAFB',
              paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999,
              alignSelf: 'center',
            }}>
              <Text style={{ fontSize: 11, fontWeight: '700', color: isConnected ? themeColours.success : '#9CA3AF' }}>
                {isConnected ? 'Active' : 'Pending'}
              </Text>
            </View>
          </View>
        ))}
      </View>

      {/* Coming soon notice */}
      {!isConnected && (
        <View style={{ backgroundColor: '#FEF3C7', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#FDE68A' }}>
          <Text style={{ fontWeight: '800', color: '#92400E', marginBottom: 4 }}>Coming soon</Text>
          <Text style={{ color: '#92400E', fontSize: 13 }}>
            Xero integration is built and ready. We are completing our Xero app certification — once approved, connecting will take less than a minute.
          </Text>
        </View>
      )}

      {/* Connect / Disconnect button */}
      {!loading && (
        isConnected ? (
          <TouchableOpacity onPress={onDisconnect} disabled={busy}
            style={{ backgroundColor: '#FEF2F2', borderRadius: 12, padding: 16, alignItems: 'center', borderWidth: 1, borderColor: '#FECACA' }}>
            {busy ? <ActivityIndicator color={themeColours.error} /> :
              <Text style={{ fontWeight: '900', color: themeColours.error }}>Disconnect Xero</Text>}
          </TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={onConnect} disabled={busy}
            style={{ backgroundColor: '#13B5EA', borderRadius: 12, padding: 16, alignItems: 'center' }}>
            {busy ? <ActivityIndicator color="#fff" /> :
              <Text style={{ fontWeight: '900', color: '#fff', fontSize: 16 }}>Connect to Xero</Text>}
          </TouchableOpacity>
        )
      )}

      {/* Learn more */}
      <TouchableOpacity onPress={() => Linking.openURL('https://developer.xero.com')}
        style={{ alignItems: 'center', padding: 8 }}>
        <Text style={{ color: themeColours.textSecondary, fontSize: 12 }}>Learn about Xero API → developer.xero.com</Text>
      </TouchableOpacity>

      <View style={{ height: 20 }} />
    </ScrollView>
  );
}

export default withErrorBoundary(XeroScreen, 'Xero');
