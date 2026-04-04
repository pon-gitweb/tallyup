import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { db } from '../services/firebase';
import { collection, onSnapshot, query } from 'firebase/firestore';
import { ensureDeptInProgress } from '../services/stockTakeStatus';

export default function AreaSelectionScreen({ navigation, route }) {
  const venueId = route?.params?.venueId;
  const departmentId = route?.params?.departmentId;
  const departmentName = route?.params?.departmentName || 'Department';

  const [areas, setAreas] = useState([]);
  const [loading, setLoading] = useState(true);

  // Ensure department shows as in_progress when user enters Areas
  useEffect(() => {
    (async () => {
      try {
        if (venueId && departmentId) {
          await ensureDeptInProgress(venueId, departmentId, departmentName);
        }
      } catch (e) {
        console.log('[AreaSelection] ensureDeptInProgress error', e?.message || e);
      }
    })();
  }, [venueId, departmentId]);

  useEffect(() => {
    if (!venueId || !departmentId) {
      setLoading(false);
      return;
    }
    const areasCol = collection(db, 'venues', venueId, 'departments', departmentId, 'areas');
    const unsub = onSnapshot(
      query(areasCol),
      snap => {
        const rows = [];
        snap.forEach(d => {
          const data = d.data() || {};
          rows.push({
            id: d.id,
            name: data.name || 'Unnamed Area',
            status: data.status || 'active',  // your seeded areas were 'active'
          });
        });
        setAreas(rows);
        setLoading(false);
      },
      err => {
        console.error('[AreaSelection] load error', err);
        Alert.alert('Areas', err?.message || 'Failed to load areas');
        setLoading(false);
      }
    );
    return () => unsub();
  }, [venueId, departmentId]);

  const openArea = (area) => {
    navigation.navigate('StockTakeAreaInventory', {
      venueId,
      departmentId,
      areaId: area.id,
      areaName: area.name,
    });
  };

  if (loading) {
    return (
      <View style={{ flex:1, justifyContent:'center', alignItems:'center' }}>
        <ActivityIndicator />
        <Text style={{ marginTop: 8 }}>Loading areas…</Text>
      </View>
    );
  }

  if (areas.length === 0) {
    return (
      <View style={{ flex:1, justifyContent:'center', alignItems:'center', padding:24 }}>
        <Text>No areas found in “{departmentName}”.</Text>
      </View>
    );
  }

  return (
    <View style={{ flex:1, padding:16 }}>
      <Text style={{ fontSize:18, fontWeight:'700', marginBottom:12 }}>
        {departmentName}: Choose Area
      </Text>
      {areas.map(area => {
        const st = area.status || 'active';
        const bg =
          st === 'completed' ? '#d1fae5' :
          st === 'in_progress' ? '#fde68a' :
          '#e5e7eb';
        return (
          <TouchableOpacity
            key={area.id}
            onPress={() => openArea(area)}
            style={{ padding:14, backgroundColor:bg, borderRadius:10, marginBottom:10 }}
          >
            <Text style={{ fontSize:16, fontWeight:'600' }}>{area.name}</Text>
            <Text style={{ marginTop:4, opacity:0.7 }}>Status: {st}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}
