import React from 'react';
import { View, StyleSheet } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ViewStyle } from 'react-native';

type Props = {
  children: React.ReactNode;
  background?: string;
  style?: ViewStyle;
};

// Inner component so useSafeAreaInsets reads from the SafeAreaProvider below.
function Frame({ children, background = '#fff', style }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.root,
        { paddingTop: insets.top, paddingBottom: insets.bottom, backgroundColor: background },
        style,
      ]}
    >
      {children}
    </View>
  );
}

// Wrap in SafeAreaProvider so insets are measured inside the Modal's separate root.
export default function FullScreenModalFrame(props: Props) {
  return (
    <SafeAreaProvider>
      <Frame {...props} />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
