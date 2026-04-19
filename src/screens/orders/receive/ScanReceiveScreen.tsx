// @ts-nocheck
import React from 'react';
import { View, Text } from 'react-native';
import { useColours } from '../../../context/ThemeContext';
export default function ScanReceiveScreen() {
  const colours = useColours();
  return <View style={{paddingVertical:8}}><Text>Scan/OCR receive (stub)</Text></View>;
}
