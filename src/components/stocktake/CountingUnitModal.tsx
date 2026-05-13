// @ts-nocheck
import React, { useEffect, useState } from 'react';
import {
  Modal, Text, TextInput, TouchableOpacity, View, ScrollView,
} from 'react-native';

export type CountingUnit = 'unit' | 'case' | 'both';

export type CountingUnitConfig = {
  countingUnit: CountingUnit;
  caseSize: number | null;
};

type Props = {
  visible: boolean;
  productName: string;
  areaName?: string;
  initialUnit?: CountingUnit;
  initialCaseSize?: number | null;
  suggestedCaseSize?: number | null;
  onSave: (config: CountingUnitConfig) => void;
  onCancel: () => void;
};

const COMMON_CASE_SIZES = [6, 12, 18, 24, 30, 48];

function suggestUnit(areaName: string | undefined): CountingUnit {
  if (!areaName) return 'unit';
  const lower = areaName.toLowerCase();
  if (/cellar|storage|cool.?room|chiller|warehouse|storeroom/.test(lower)) return 'case';
  if (/fridge|bar|service|floor|tap/.test(lower)) return 'unit';
  return 'unit';
}

export default function CountingUnitModal({
  visible,
  productName,
  areaName,
  initialUnit,
  initialCaseSize,
  suggestedCaseSize,
  onSave,
  onCancel,
}: Props) {
  const defaultUnit = initialUnit ?? suggestUnit(areaName);
  const [selected, setSelected] = useState<CountingUnit>(defaultUnit);
  const [caseSize, setCaseSize] = useState<string>(
    String(initialCaseSize ?? suggestedCaseSize ?? '')
  );
  const [customCaseSize, setCustomCaseSize] = useState('');

  useEffect(() => {
    if (visible) {
      setSelected(initialUnit ?? suggestUnit(areaName));
      setCaseSize(String(initialCaseSize ?? suggestedCaseSize ?? ''));
      setCustomCaseSize('');
    }
  }, [visible]);

  const resolvedCaseSize = (): number | null => {
    if (selected === 'unit') return null;
    const n = parseInt(customCaseSize || caseSize, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  const handleSave = () => {
    onSave({ countingUnit: selected, caseSize: resolvedCaseSize() });
  };

  const RadioOption = ({
    value, label, sub,
  }: { value: CountingUnit; label: string; sub: string }) => (
    <TouchableOpacity
      onPress={() => setSelected(value)}
      style={{
        flexDirection: 'row', alignItems: 'flex-start', gap: 12,
        paddingVertical: 12, paddingHorizontal: 16,
        backgroundColor: selected === value ? '#EFF6FF' : '#fff',
        borderRadius: 10, marginBottom: 8,
        borderWidth: 1.5,
        borderColor: selected === value ? '#3B82F6' : '#e2e8f0',
      }}
      activeOpacity={0.75}
    >
      <View style={{
        width: 20, height: 20, borderRadius: 10, borderWidth: 2,
        borderColor: selected === value ? '#3B82F6' : '#cbd5e1',
        marginTop: 1, alignItems: 'center', justifyContent: 'center',
      }}>
        {selected === value && (
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: '#3B82F6' }} />
        )}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontWeight: '700', color: '#0f172a', fontSize: 14 }}>{label}</Text>
        <Text style={{ color: '#64748b', fontSize: 12, marginTop: 2, lineHeight: 17 }}>{sub}</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onCancel}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' }}>
        <TouchableOpacity style={{ flex: 1 }} onPress={onCancel} activeOpacity={1} />
        <View style={{
          backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20,
          padding: 24, paddingBottom: 36,
          shadowColor: '#000', shadowOffset: { width: 0, height: -2 }, shadowOpacity: 0.1, shadowRadius: 8, elevation: 8,
        }}>
          <Text style={{ fontSize: 17, fontWeight: '800', color: '#0f172a', marginBottom: 4 }}>
            How will you count {productName}?
          </Text>
          {areaName && (
            <Text style={{ fontSize: 12, color: '#64748b', marginBottom: 16 }}>
              In {areaName}
            </Text>
          )}

          <RadioOption
            value="unit"
            label="Individual units"
            sub="Count each bottle/can/item separately"
          />

          <RadioOption
            value="case"
            label="Cases"
            sub="Count in full cases — enter a case size below"
          />

          <RadioOption
            value="both"
            label="Both — cases and loose units"
            sub="Count full cases plus individual extras"
          />

          {(selected === 'case' || selected === 'both') && (
            <View style={{ marginTop: 4, marginBottom: 8 }}>
              <Text style={{ fontSize: 13, fontWeight: '700', color: '#374151', marginBottom: 8 }}>
                Case size (units per case):
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {(suggestedCaseSize && !COMMON_CASE_SIZES.includes(suggestedCaseSize)
                    ? [suggestedCaseSize, ...COMMON_CASE_SIZES]
                    : COMMON_CASE_SIZES
                  ).map(sz => (
                    <TouchableOpacity
                      key={sz}
                      onPress={() => { setCaseSize(String(sz)); setCustomCaseSize(''); }}
                      style={{
                        paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8,
                        backgroundColor: (customCaseSize === '' && caseSize === String(sz)) ? '#1b4f72' : '#f1f5f9',
                        borderWidth: 1,
                        borderColor: (customCaseSize === '' && caseSize === String(sz)) ? '#1b4f72' : '#e2e8f0',
                      }}
                    >
                      <Text style={{
                        fontWeight: '700', fontSize: 14,
                        color: (customCaseSize === '' && caseSize === String(sz)) ? '#fff' : '#374151',
                      }}>
                        {sz}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
              <TextInput
                value={customCaseSize}
                onChangeText={(t) => { setCustomCaseSize(t.replace(/[^0-9]/g, '')); }}
                placeholder="Custom size…"
                keyboardType="number-pad"
                placeholderTextColor="#94a3b8"
                style={{
                  borderWidth: 1, borderColor: customCaseSize ? '#1b4f72' : '#e2e8f0',
                  borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9,
                  fontSize: 14, color: '#0f172a', backgroundColor: '#f9fafb',
                }}
              />
            </View>
          )}

          <TouchableOpacity
            onPress={handleSave}
            style={{
              backgroundColor: '#1b4f72', borderRadius: 12,
              paddingVertical: 14, alignItems: 'center', marginTop: 8,
            }}
          >
            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>
              Save to {areaName || 'area'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={onCancel}
            style={{ alignItems: 'center', paddingVertical: 12, marginTop: 4 }}
          >
            <Text style={{ color: '#94a3b8', fontSize: 13 }}>
              Skip — use individual units
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
