import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { db } from '../services/firebase';
import { collection, onSnapshot, doc, onSnapshot as onDocSnapshot } from 'firebase/firestore';

export default function DepartmentSelectionScreen({ navigation, route }) {
  const venueId = route?.params?.venueId;
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const stockUnsubsRef = useRef({}); // deptId -> unsub

  useEffect(() => {
    if (!venueId) return;
    // Subscribe to departments list
    const deptCol = collection(db, 'venues', venueId, 'departments');
    const unsub = onSnapshot(
      deptCol,
      (snap) => {
        const rows = [];
        snap.forEach(d => {
          const data = d.data() || {};
          rows.push({
            id: d.id,
            key: data.key || 'unknown',
            name: data.name || 'Unnamed Department',
            status: 'idle', // will be updated by stockTakes subscriptions below
          });
        });

        // Tear down old stockTakes listeners
        Object.values(stockUnsubsRef.current).forEach(fn => fn && fn());
        stockUnsubsRef.current = {};

        // For each department, subscribe to stockTakes/{deptId} and reflect status
        rows.forEach((row, idx) => {
          const ref = doc(db, 'venues', venueId, 'stockTakes', row.id);
          const unsubStock = onDocSnapshot(
            ref,
            (docSnap) => {
              const st = docSnap.exists() ? (docSnap.data().status || 'idle') : 'idle';
              setDepartments(prev => {
                const copy = [...prev];
                const i = copy.findIndex(x => x.id === row.id);
                if (i >= 0) copy[i] = { ...copy[i], status: st };
                return copy;
              });
            },
            (err) => console.log('[Dept stockTakes subscribe error]', err?.message || err)
          );
          stockUnsubsRef.current[row.id] = unsubStock;
        });

        // Set initial rows (statuses will update as stockTakes snapshots land)
        setDepartments(rows);
        setLoading(false);
      },
      (err) => {
        console.error('[Departments] error', err);
        Alert.alert('Departments', err?.message || 'Failed to load departments');
        setLoading(false);
      }
    );

    return () => {
      unsub && unsub();
      Object.values(stockUnsubsRef.current).forEach(fn => fn && fn());
      stockUnsubsRef.current = {};
    };
  }, [venueId]);

  const openDepartment = (dept) => {
    navigation.navigate('AreaSelection', {
      venueId,
      departmentId: dept.id,
      departmentName: dept.name,
    });
  };

  if (loading) {
    return (
      <View style={{ flex:1, justifyContent:'center', alignItems:'center' }}>
        <ActivityIndicator />
        <Text style={{ marginTop: 8 }}>Loading departments…</Text>
      </View>
    );
  }

  if (departments.length === 0) {
    return (
      <View style={{ flex:1, justifyContent:'center', alignItems:'center', padding:24 }}>
        <Text>No departments found.</Text>
      </View>
    );
  }

  return (
    <View style={{ flex:1, padding:16 }}>
      <Text style={{ fontSize:18, fontWeight:'700', marginBottom:12 }}>Choose Department</Text>
      {departments.map(dept => {
        const st = dept.status || 'idle';
        const bg =
          st === 'completed' ? '#d1fae5' :
          st === 'in_progress' ? '#fde68a' :
          '#e5e7eb';
        return (
          <TouchableOpacity
            key={dept.id}
            onPress={() => openDepartment(dept)}
            style={{ padding:14, backgroundColor:bg, borderRadius:10, marginBottom:10 }}
          >
            <Text style={{ fontSize:16, fontWeight:'600' }}>{dept.name}</Text>
            <Text style={{ marginTop:4, opacity:0.7 }}>Status: {st}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}
