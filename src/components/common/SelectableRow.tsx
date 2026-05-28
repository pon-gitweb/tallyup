// @ts-nocheck
import React from 'react';
import { View, TouchableOpacity, Text, StyleSheet } from 'react-native';

interface SelectableRowProps {
  isSelected: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  style?: object;
}

// TODO: consolidate with the inline checkbox in ProductsScreen renderItem
export function SelectableRow({ isSelected, onToggle, children, style }: SelectableRowProps) {
  return (
    <TouchableOpacity
      onPress={onToggle}
      style={[S.row, isSelected && S.rowSelected, style]}
      activeOpacity={0.75}
    >
      <View style={[S.checkbox, isSelected && S.checkboxSelected]}>
        {isSelected && <Text style={S.checkmark}>✓</Text>}
      </View>
      <View style={{ flex: 1 }}>{children}</View>
    </TouchableOpacity>
  );
}

const S = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e5e1d8',
    padding: 12,
  },
  rowSelected: {
    backgroundColor: '#f0fdfa',
    borderColor: '#14b8a6',
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: '#d1d5db',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    backgroundColor: '#fff',
  },
  checkboxSelected: {
    backgroundColor: '#14b8a6',
    borderColor: '#14b8a6',
  },
  checkmark: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '900',
    lineHeight: 16,
  },
});
