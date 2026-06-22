/**
 * MYOBScreen — Settings → MYOB Integration
 * Connects venue to MYOB Business via OAuth2.
 * Structure ready — activation requires MYOB developer account registration
 * and sandbox testing. Register at developer.myob.com
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Linking, ScrollView, Text, TouchableOpacity, View, ActivityIndicator } from 'react-native';
import { MYOBService, MYOBConnection } from '../../services/integrations/myob/MYOBService';
import { useVenueId } from '../../context/VenueProvider';
import { withErrorBoundary } from '../../components/ErrorCatcher';
import { useColours } from '../../context/ThemeContext';
import { useToast } from '../../components/common/Toast';
import { useConfirmModal } from '../../components/common/useConfirmModal';

function MYOBScreen() {
  const venueId = useVenueId();
  const colours = useColours();
  const { showError } = useToast();
  const { confirm, modal } = useConfirmModal();
  const [connection, setConnection] = useState<MYOBConnection>({ status: 'not_connected' });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!venueId) return;
    setLoading(true);
    const conn = await MYOBService.getConnection(venueId);
    setConnection(conn);
    setLoading(false);
  }, [venueId]);

  useEffect(() => { load(); }, [load]);

  const onConnect = useCallback(() => {
    if (!venueId) return;
    confirm({
      title: 'Connect to MYOB',
      message: 'You will be taken to MYOB to authorise Hosti. Once connected, purchase orders and invoices will sync automatically.',
      confirmLabel: 'Connect',
      onConfirm: async () => {
        setBusy(true);
        try {
          await MYOBService.startOAuthFlow(venueId);
        } catch (e: any) {
          showError(e?.message || 'Could not open MYOB. Please try again.');
        }
        setBusy(false);
      },
    });
  }, [venueId, confirm, showError]);

  const onDisconnect = useCallback(() => {
    if (!venueId) return;
    confirm({
      title: 'Disconnect MYOB',
      message: 'This will stop syncing with MYOB. Your existing MYOB data will not be affected.',
      confirmLabel: 'Disconnect',
      destructive: true,
      onConfirm: async () => {
        setBusy(true);
        await MYOBService.disconnect(venueId);
        await load();
        setBusy(false);
      },
    });
  }, [venueId, load, confirm]);

  const isConnected = connection.status === 'connected';

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colours.background }} contentContainerStyle={{ padding: 16, gap: 16 }}>

      {/* Header */}
      <View style={{ backgroundColor: colours.deepBlue, borderRadius: 16, padding: 20 }}>
        <Text style={{ fontSize: 28, fontWeight: '900', color: colours.primaryText }}>MYOB</Text>
        <Text style={{ color: colours.primaryText, opacity: 0.85, marginTop: 4, fontSize: 14 }}>
          Connect your MYOB Business account to automatically sync purchase orders and invoices.
        </Text>
      </View>

      {/* Status */}
      {loading ? (
        <ActivityIndicator color={colours.accent} />
      ) : (
        <View style={{
          backgroundColor: colours.surface, borderRadius: 14, padding: 16,
          borderWidth: 1, borderColor: isConnected ? colours.success : colours.border,
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{
              width: 12, height: 12, borderRadius: 6,
              backgroundColor: isConnected ? colours.success : colours.textSecondary,
            }} />
            <Text style={{ fontWeight: '900', color: colours.text, fontSize: 16 }}>
              {isConnected ? 'Connected' : 'Not connected'}
            </Text>
          </View>
          {isConnected && connection.companyFileName && (
            <Text style={{ color: colours.textSecondary, marginTop: 4, fontSize: 13 }}>
              Company file: {connection.companyFileName}
            </Text>
          )}
          {isConnected && connection.connectedAt && (
            <Text style={{ color: colours.textSecondary, fontSize: 12, marginTop: 2 }}>
              Connected: {new Date(connection.connectedAt).toLocaleDateString('en-NZ')}
            </Text>
          )}
        </View>
      )}

      {/* What syncs */}
      <View style={{ backgroundColor: colours.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: colours.border }}>
        <Text style={{ fontWeight: '900', color: colours.text, marginBottom: 12 }}>What syncs with MYOB</Text>
        {[
          { icon: '📋', title: 'Purchase Orders', desc: 'Orders placed in Hosti appear as Bills in MYOB' },
          { icon: '🧾', title: 'Received Invoices', desc: 'Approved invoices are pushed to MYOB as Bills' },
          { icon: '🏢', title: 'Supplier Contacts', desc: 'Your MYOB contacts are available when setting up suppliers' },
        ].map((item, i) => (
          <View key={i} style={{ flexDirection: 'row', gap: 12, marginBottom: i < 2 ? 14 : 0 }}>
            <Text style={{ fontSize: 20 }}>{item.icon}</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '800', color: colours.text }}>{item.title}</Text>
              <Text style={{ color: colours.textSecondary, fontSize: 13, marginTop: 2 }}>{item.desc}</Text>
            </View>
            <View style={{
              backgroundColor: isConnected ? colours.positiveSoft : colours.background,
              paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999,
              alignSelf: 'center',
            }}>
              <Text style={{ fontSize: 11, fontWeight: '700', color: isConnected ? colours.success : colours.textSecondary }}>
                {isConnected ? 'Active' : 'Pending'}
              </Text>
            </View>
          </View>
        ))}
      </View>

      {/* Coming soon notice */}
      {!isConnected && (
        <View style={{ backgroundColor: colours.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: colours.warning }}>
          <Text style={{ fontWeight: '800', color: colours.warning, marginBottom: 4 }}>Coming soon</Text>
          <Text style={{ color: colours.text, fontSize: 13 }}>
            MYOB integration is built and ready. We are completing our MYOB developer account registration and sandbox testing — once approved, connecting will take less than a minute.
          </Text>
        </View>
      )}

      {/* Connect / Disconnect button */}
      {!loading && (
        isConnected ? (
          <TouchableOpacity onPress={onDisconnect} disabled={busy}
            style={{ backgroundColor: colours.surface, borderRadius: 12, padding: 16, alignItems: 'center', borderWidth: 1, borderColor: colours.danger }}>
            {busy ? <ActivityIndicator color={colours.danger} /> :
              <Text style={{ fontWeight: '900', color: colours.danger }}>Disconnect MYOB</Text>}
          </TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={onConnect} disabled={busy}
            style={{ backgroundColor: colours.deepBlue, borderRadius: 12, padding: 16, alignItems: 'center' }}>
            {busy ? <ActivityIndicator color={colours.primaryText} /> :
              <Text style={{ fontWeight: '900', color: colours.primaryText, fontSize: 16 }}>Connect to MYOB</Text>}
          </TouchableOpacity>
        )
      )}

      {/* Learn more */}
      <TouchableOpacity onPress={() => Linking.openURL('https://developer.myob.com')}
        style={{ alignItems: 'center', padding: 8 }}>
        <Text style={{ color: colours.textSecondary, fontSize: 12 }}>Learn about MYOB API → developer.myob.com</Text>
      </TouchableOpacity>

      <View style={{ height: 20 }} />
      {modal}
    </ScrollView>
  );
}

export default withErrorBoundary(MYOBScreen, 'MYOB');
