// @ts-nocheck
import React from 'react';
import { View, Text } from 'react-native';
import { useColours } from '../../../context/ThemeContext';
export default function PdfReceiveScreen() {
  const colours = useColours();
  return <View style={{paddingVertical:8}}><Text>PDF receive (stub)</Text></View>;
}
