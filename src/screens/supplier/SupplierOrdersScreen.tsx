// @ts-nocheck
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Text, TouchableOpacity, View } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { SupplierPortalService, SupplierOrderView, SupplierOrderStatus } from '../../services/supplier/SupplierPortalService';
import { useColours } from '../../context/ThemeContext';
import { withErrorBoundary } from '../../components/ErrorCatcher';

const STATUS_COLOURS: Record<SupplierOrderStatus, string> = {
  pending: '#F59E0B', acknowledged: '#2563EB',
  partial: '#7C3AED', fulfilled: '#16A34A', cancelled: '#DC2626',
};

function SupplierOrdersScreen() {
  const route = useRoute<any>();
  const { supplierId } = route.params;
  const C = useColours();
  const [orders, setOrders] = useState<SupplierOrderView[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setOrders(await SupplierPortalService.getOrders(supplierId));
    setLoading(false);
  }, [supplierId]);

  useEffect(() => { load(); }, [load]);

  const onUpdateStatus = useCallback((order: SupplierOrderView) => {
    Alert.alert('Update order status', `PO: ${order.poNumber || order.id}`, [
      { text: 'Acknowledge', onPress: () => SupplierPortalService.acknowledgeOrder(supplierId, order.id).then(load) },
      { text: 'Mark fulfilled', onPress: () => SupplierPortalService.updateOrderStatus(supplierId, order.id, 'fulfilled').then(load) },
      { text: 'Mark partial', onPress: () => SupplierPortalService.updateOrderStatus(supplierId, order.id, 'partial').then(load) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [supplierId, load]);

  return (
    <View style={{ flex: 1, backgroundColor: C.background }}>
      {loading ? <ActivityIndicator style={{ flex: 1 }} color={C.accent} /> : (
        <FlatList data={orders} keyExtractor={o => o.id}
          renderItem={({ item }) => (
            <TouchableOpacity onPress={() => onUpdateStatus(item)}
              style={{ backgroundColor: C.surface, margin: 8, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: C.border }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                <Text style={{ fontWeight: '900', color: C.text }}>{item.venueName || item.venueId}</Text>
                <View style={{ backgroundColor: STATUS_COLOURS[item.status] + '20', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999 }}>
                  <Text style={{ fontSize: 12, fontWeight: '800', color: STATUS_COLOURS[item.status], textTransform: 'capitalize' }}>{item.status}</Text>
                </View>
              </View>
              <Text style={{ color: C.textSecondary, fontSize: 13 }}>PO: {item.poNumber || item.id.slice(0, 8)}</Text>
              <Text style={{ color: C.textSecondary, fontSize: 12, marginTop: 2 }}>{item.lines?.length || 0} items</Text>
              {item.lines?.slice(0, 3).map((l, i) => (
                <Text key={i} style={{ color: C.text, fontSize: 13, marginTop: 2 }}>• {l.name}: {l.qty} {l.unit || 'units'}</Text>
              ))}
              {(item.lines?.length || 0) > 3 && <Text style={{ color: C.textSecondary, fontSize: 12 }}>+{item.lines.length - 3} more</Text>}
            </TouchableOpacity>
          )}
          ListEmptyComponent={<Text style={{ textAlign: 'center', color: C.textSecondary, marginTop: 60 }}>No orders yet</Text>}
        />
      )}
    </View>
  );
}
export default withErrorBoundary(SupplierOrdersScreen, 'SupplierOrders');
