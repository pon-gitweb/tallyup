// @ts-nocheck
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SupplierPortalService, SupplierAccount, SupplierOrderView } from '../../services/supplier/SupplierPortalService';
import { useColours } from '../../context/ThemeContext';
import { withErrorBoundary } from '../../components/ErrorCatcher';

function SupplierDashboardScreen({ supplierId }: { supplierId: string }) {
  const nav = useNavigation<any>();
  const colours = useColours();
  const [account, setAccount] = useState<SupplierAccount | null>(null);
  const [orders, setOrders] = useState<SupplierOrderView[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [acc, ords] = await Promise.all([
      SupplierPortalService.getAccount(supplierId),
      SupplierPortalService.getOrders(supplierId),
    ]);
    setAccount(acc);
    setOrders(ords);
    setLoading(false);
  }, [supplierId]);

  useEffect(() => { load(); }, [load]);

  const pending = orders.filter(o => o.status === 'pending');
  const recent = orders.filter(o => o.status !== 'pending').slice(0, 5);

  if (loading) return <ActivityIndicator style={{ flex: 1 }} color={colours.accent} />;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colours.background }} contentContainerStyle={{ padding: 16, gap: 16 }}>
      {/* Header */}
      <View style={{ backgroundColor: colours.primary, borderRadius: 16, padding: 20 }}>
        <Text style={{ fontSize: 22, fontWeight: '900', color: '#fff' }}>{account?.name || 'Supplier Portal'}</Text>
        <Text style={{ color: 'rgba(255,255,255,0.8)', marginTop: 4 }}>{account?.connectedVenues?.length || 0} connected venues</Text>
      </View>

      {/* Quick stats */}
      <View style={{ flexDirection: 'row', gap: 10 }}>
        {[
          { label: 'Pending orders', value: pending.length, colour: colours.warning },
          { label: 'Total orders', value: orders.length, colour: colours.accent },
          { label: 'Venues', value: account?.connectedVenues?.length || 0, colour: colours.success },
        ].map((stat, i) => (
          <View key={i} style={{ flex: 1, backgroundColor: colours.surface, borderRadius: 12, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: colours.border }}>
            <Text style={{ fontSize: 28, fontWeight: '900', color: stat.colour }}>{stat.value}</Text>
            <Text style={{ color: colours.textSecondary, fontSize: 11, textAlign: 'center', marginTop: 2 }}>{stat.label}</Text>
          </View>
        ))}
      </View>

      {/* Navigation */}
      {[
        { icon: '📦', label: 'Catalogue & Pricing', route: 'SupplierCatalogue' },
        { icon: '📋', label: 'Orders', route: 'SupplierOrders' },
        { icon: '🏷️', label: 'Specials & Promotions', route: 'SupplierSpecials' },
      ].map((item, i) => (
        <TouchableOpacity key={i} onPress={() => nav.navigate(item.route, { supplierId })}
          style={{ backgroundColor: colours.surface, borderRadius: 14, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 14, borderWidth: 1, borderColor: colours.border }}>
          <Text style={{ fontSize: 24 }}>{item.icon}</Text>
          <Text style={{ fontWeight: '800', color: colours.text, fontSize: 16 }}>{item.label}</Text>
          <Text style={{ marginLeft: 'auto', color: colours.textSecondary, fontSize: 18 }}>›</Text>
        </TouchableOpacity>
      ))}

      {/* Pending orders */}
      {pending.length > 0 && (
        <View style={{ backgroundColor: '#FEF3C7', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#FDE68A' }}>
          <Text style={{ fontWeight: '900', color: '#92400E', marginBottom: 8 }}>⚡ {pending.length} pending order{pending.length > 1 ? 's' : ''}</Text>
          {pending.map(o => (
            <TouchableOpacity key={o.id} onPress={() => nav.navigate('SupplierOrders', { supplierId })}
              style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 }}>
              <Text style={{ color: '#92400E', fontWeight: '700' }}>{o.venueName || o.venueId}</Text>
              <Text style={{ color: '#92400E', fontSize: 12 }}>PO: {o.poNumber || o.id.slice(0, 8)}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </ScrollView>
  );
}
export default withErrorBoundary(SupplierDashboardScreen, 'SupplierDashboard');
