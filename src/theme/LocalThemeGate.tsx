// @ts-nocheck
import React from 'react';
import { View } from 'react-native';

// Minimal pass-through gate to keep builds stable.
// If you later want to enable V2 theme per-screen, you can read a flag here
// and wrap children with ThemeProvider(s).
export default function LocalThemeGate({ children }) {
  return <View style={{ flex: 1 }}>{children}</View>;
}
