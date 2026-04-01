// @ts-nocheck
/**
 * HintBubble — contextual one-time hint
 * Shows once, dismissed with "Got it" or by performing the action.
 * Never blocks UI. Never interrupts. Always honest.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Animated, Text, TouchableOpacity, View } from 'react-native';
import { HintService, HintId, HINT_CONTENT } from '../../services/hints/HintService';

type Props = {
  id: HintId;
  style?: any;
};

export default function HintBubble({ id, style }: Props) {
  const [visible, setVisible] = useState(false);
  const fadeAnim = React.useRef(new Animated.Value(0)).current;
  const hint = HINT_CONTENT[id];

  useEffect(() => {
    HintService.shouldShow(id).then(should => {
      if (should) {
        setVisible(true);
        Animated.timing(fadeAnim, { toValue: 1, duration: 500, delay: 800, useNativeDriver: true }).start();
      }
    });
  }, [id]);

  const onDismiss = useCallback(async () => {
    Animated.timing(fadeAnim, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => {
      setVisible(false);
    });
    await HintService.dismiss(id);
  }, [id, fadeAnim]);

  if (!visible || !hint) return null;

  return (
    <Animated.View style={[{
      opacity: fadeAnim,
      backgroundColor: '#FEF3C7',
      borderRadius: 10,
      borderWidth: 1,
      borderColor: '#FDE68A',
      padding: 10,
      marginHorizontal: 12,
      marginVertical: 4,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    }, style]}>
      <Text style={{ fontSize: 16 }}>{hint.icon}</Text>
      <Text style={{ flex: 1, color: '#92400E', fontSize: 13, fontWeight: '600' }}>
        {hint.text}
      </Text>
      <TouchableOpacity onPress={onDismiss} style={{
        backgroundColor: '#FDE68A', paddingHorizontal: 10,
        paddingVertical: 4, borderRadius: 999,
      }}>
        <Text style={{ color: '#92400E', fontWeight: '800', fontSize: 12 }}>Got it</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}
