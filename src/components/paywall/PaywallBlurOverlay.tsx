import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { BlurView } from 'expo-blur';
import { useColours, useTheme } from '../../context/ThemeContext';

type Props = {
  onActivate: () => void;
  children: React.ReactNode;
  message?: string;
};

export default function PaywallBlurOverlay({
  onActivate,
  children,
  message = 'Activate to unlock'
}: Props) {
  const c = useColours();
  const { theme } = useTheme();

  return (
    <View style={styles.container}>
      {/* Actual content renders below */}
      <View style={styles.content}>
        {children}
      </View>

      {/* Blur overlay on top */}
      <BlurView
        intensity={18}
        tint="light"
        style={StyleSheet.absoluteFillObject}
      >
        <View style={[
          styles.overlay,
          { backgroundColor: 'rgba(245,243,238,0.3)' }
        ]}>
          <View style={[styles.lockCard, { backgroundColor: c.surface || '#ffffff' }]}>
            <Text style={styles.lockIcon}>🔒</Text>
            <Text style={[styles.lockTitle, { color: c.missionSlate || '#3b3f4a', fontFamily: theme.fontBodySemiBold }]}>
              {message}
            </Text>
            <TouchableOpacity
              style={[styles.activateBtn, { backgroundColor: c.deepBlue || '#1b4f72' }]}
              onPress={onActivate}
            >
              <Text style={[styles.activateBtnText, { fontFamily: theme.fontBodySemiBold }]}>
                Activate — $349
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </BlurView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { position: 'relative' },
  content: { /* Content renders normally underneath */ },
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  lockCard: {
    borderRadius: 16, padding: 24, alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12, shadowRadius: 12, elevation: 6,
    width: '100%', maxWidth: 300
  },
  lockIcon: { fontSize: 32, marginBottom: 12 },
  lockTitle: { fontSize: 15, textAlign: 'center', marginBottom: 16 },
  activateBtn: { width: '100%', height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  activateBtnText: { color: '#ffffff', fontSize: 15 }
});
