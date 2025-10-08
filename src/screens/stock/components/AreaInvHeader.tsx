// @ts-nocheck
import React from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';

type Stats = { countedCount: number; total: number; lowCount: number; flaggedCount: number; progressPct: number };

type Props = {
  areaName?: string;
  isCompact: boolean;
  dens: (n: number) => number;

  startedAt: Date | null;
  lastActivityDate: Date | null;

  offline: boolean;
  legendDismissed: boolean;
  dismissLegend: () => void;

  showExpected: boolean;
  setShowExpected: (v: boolean) => void;

  filter: string;
  setFilter: (s: string) => void;

  addingName: string;
  setAddingName: (s: string) => void;
  addingUnit: string;
  setAddingUnit: (s: string) => void;
  addingSupplier: string;
  setAddingSupplier: (s: string) => void;
  onAddQuickItem: () => void;

  stats: Stats;
  onOpenMore: () => void;

  nameInputRef: any;
};

const fmt = (d: Date | null) => (d ? d.toLocaleString() : '—');

const AreaInvHeader = React.memo(function AreaInvHeader({
  areaName,
  isCompact,
  dens,
  startedAt,
  lastActivityDate,
  offline,
  legendDismissed,
  dismissLegend,
  showExpected, setShowExpected,
  filter, setFilter,
  addingName, setAddingName,
  addingUnit, setAddingUnit,
  addingSupplier, setAddingSupplier,
  onAddQuickItem,
  stats,
  onOpenMore,
  nameInputRef,
}: Props) {
  return (
    <View style={{ backgroundColor: 'white', paddingBottom: dens(8), borderBottomWidth: 1, borderBottomColor: '#eee' }}>
      <View style={{ padding: dens(12), gap: 8 }}>
        {/* Title + stats + ⋯ */}
        <View style={{ flexDirection:'row', alignItems:'center', justifyContent:'space-between' }}>
          <View style={{ flexShrink: 1 }}>
            <Text style={{ fontSize: isCompact ? 16 : 18, fontWeight: '800' }} numberOfLines={1}>
              {areaName ?? 'Area Inventory'}
            </Text>
            <View style={{ flexDirection:'row', alignItems:'center', marginTop: 4 }}>
              <Text style={{ opacity: 0.7, fontSize: 12 }} numberOfLines={1}>
                Started at: {fmt(startedAt)} • Last activity: {fmt(lastActivityDate)}
              </Text>
            </View>
          </View>

          <View style={{ flexDirection:'row', gap:8, alignItems:'center' }}>
            <View style={{ paddingVertical:2, paddingHorizontal:8, backgroundColor:'#F3F4F6', borderRadius:12 }}>
              <Text style={{ fontWeight:'800', color:'#374151' }}>
                {stats.countedCount}/{stats.total} • {stats.lowCount} low • {stats.flaggedCount} flag • {stats.progressPct}%
              </Text>
            </View>
            <TouchableOpacity onPress={onOpenMore} style={{ paddingVertical:6, paddingHorizontal:10, borderRadius:12, backgroundColor:'#E5E7EB' }}>
              <Text style={{ fontWeight:'900' }}>⋯</Text>
            </TouchableOpacity>
          </View>
        </View>

        {offline ? (
          <View style={{ backgroundColor:'#FEF3C7', borderColor:'#F59E0B', borderWidth:1, padding:6, borderRadius:8 }}>
            <Text style={{ color:'#92400E', fontWeight:'700' }}>Offline</Text>
            <Text style={{ color:'#92400E' }}>You can keep counting; changes will sync when back online.</Text>
          </View>
        ) : null}

        {!legendDismissed ? (
          <View style={{ backgroundColor:'#EFF6FF', borderColor:'#93C5FD', borderWidth:1, padding:8, borderRadius:10 }}>
            <Text style={{ color:'#1E3A8A', fontWeight:'700' }}>Tip</Text>
            <Text style={{ color:'#1E3A8A' }}>
              “Expected” is our guidance based on last count and movements. Type your Count and press Save (or Approve now).
            </Text>
            <TouchableOpacity onPress={dismissLegend} style={{ alignSelf:'flex-start', marginTop:6, paddingVertical:6, paddingHorizontal:10, backgroundColor:'#DBEAFE', borderRadius:8 }}>
              <Text style={{ color:'#1E3A8A', fontWeight:'700' }}>Got it</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Search + toggle */}
        <View style={{ flexDirection: 'row', gap: 8, alignItems:'center', flexWrap:'wrap' }}>
          <View style={{ flex: 1, position: 'relative' }}>
            <TextInput
              value={filter}
              onChangeText={setFilter}
              placeholder="Search items…"
              style={{ paddingVertical: dens(8), paddingHorizontal: filter ? 34 : dens(12), borderWidth: 1, borderColor: '#ccc', borderRadius: 12, height: Math.max(40, dens(40)) }}
              returnKeyType="search"
              blurOnSubmit={false}
            />
            {filter ? (
              <TouchableOpacity
                onPress={() => setFilter('')}
                style={{ position: 'absolute', right: 8, top: 8, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8, backgroundColor: '#EEEEEE' }}
              >
                <Text style={{ fontWeight:'800' }}>×</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          <TouchableOpacity onPress={() => setShowExpected(!showExpected)} style={{ paddingVertical: dens(8), paddingHorizontal: dens(12), borderRadius: 10, backgroundColor: '#F1F8E9' }}>
            <Text style={{ color: '#558B2F', fontWeight: '700' }}>{showExpected ? 'Hide expected' : 'Show expected'}</Text>
          </TouchableOpacity>
        </View>

        {/* Quick Add */}
        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <TextInput
              ref={nameInputRef}
              value={addingName}
              onChangeText={setAddingName}
              placeholder="Quick add item name"
              style={{ flex: 1, paddingVertical: dens(8), paddingHorizontal: dens(12), borderWidth: 1, borderColor: '#ccc', borderRadius: 12, height: Math.max(40, dens(40)) }}
              returnKeyType="done"
              blurOnSubmit={false}
              onSubmitEditing={onAddQuickItem}
            />
            <TouchableOpacity onPress={onAddQuickItem}
              style={{ backgroundColor: '#0A84FF', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 12 }}>
              <Text style={{ color: '#fff', fontWeight: '800' }}>Add</Text>
            </TouchableOpacity>
          </View>
          <View style={{ flexDirection:'row', gap:8 }}>
            <TextInput
              value={addingUnit}
              onChangeText={setAddingUnit}
              placeholder="Unit (e.g. bottles, kg)"
              style={{ flex:1, paddingVertical:8, paddingHorizontal:12, borderWidth:1, borderColor:'#ddd', borderRadius:10 }}
              returnKeyType="done"
              blurOnSubmit={false}
              onSubmitEditing={onAddQuickItem}
            />
            <TextInput
              value={addingSupplier}
              onChangeText={setAddingSupplier}
              placeholder="Supplier"
              style={{ flex:1, paddingVertical:8, paddingHorizontal:12, borderWidth:1, borderColor:'#ddd', borderRadius:10 }}
              returnKeyType="done"
              blurOnSubmit={false}
              onSubmitEditing={onAddQuickItem}
            />
          </View>
        </View>
      </View>
    </View>
  );
});

export default AreaInvHeader;
