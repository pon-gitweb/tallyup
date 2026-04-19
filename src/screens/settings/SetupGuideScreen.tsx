// @ts-nocheck
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { GuideState, GuideStep, resetGuide, dismissGuide, getCompletedCount, loadGuideState, markStepComplete } from '../../services/guide/SetupGuideService';
import { withErrorBoundary } from '../../components/ErrorCatcher';
import { useColours } from '../../context/ThemeContext';

function SetupGuideScreen() {
  const nav = useNavigation<any>();
  const colours = useColours();
  const [state, setState] = useState<GuideState | null>(null);

  const load = useCallback(async () => { setState(await loadGuideState()); }, []);
  useEffect(() => { load(); }, []);

  const onAction = useCallback(async (step: GuideStep) => {
    await markStepComplete(step.id);
    nav.navigate(step.actionRoute as never, step.actionParams as never);
    load();
  }, [nav, load]);

  const onReset = useCallback(() => {
    Alert.alert('Reset guide', 'This will reset all progress and show the guide again from the start.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reset', style: 'destructive', onPress: async () => { await resetGuide(); load(); } },
    ]);
  }, [load]);

  const onRestore = useCallback(async () => { await resetGuide(); load(); }, [load]);

  if (!state) return null;

  const completed = getCompletedCount(state.steps);
  const total = state.steps.length;
  const pct = Math.round((completed / total) * 100);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#fff' }} contentContainerStyle={{ padding: 16, gap: 16 }}>
      <View>
        <Text style={{ fontSize: 24, fontWeight: '900' }}>Setup Guide</Text>
        <Text style={{ color: '#6B7280', marginTop: 4 }}>Follow these steps to get Hosti-Stock working for your venue. You can come back anytime.</Text>
      </View>

      <View style={{ backgroundColor: '#EFF6FF', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#BFDBFE' }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
          <Text style={{ fontWeight: '800', color: '#1D4ED8' }}>{completed} of {total} complete</Text>
          <Text style={{ color: '#1D4ED8', fontWeight: '700' }}>{pct}%</Text>
        </View>
        <View style={{ height: 8, backgroundColor: '#BFDBFE', borderRadius: 4, overflow: 'hidden' }}>
          <View style={{ height: 8, width: pct + '%', backgroundColor: '#2563EB', borderRadius: 4 }} />
        </View>
        {state.guideFullyDismissed && (
          <TouchableOpacity onPress={onRestore} style={{ marginTop: 10 }}>
            <Text style={{ color: '#2563EB', fontWeight: '700', textAlign: 'center' }}>Restore guide banner on dashboard</Text>
          </TouchableOpacity>
        )}
      </View>

      {state.steps.map((step, i) => (
        <View key={step.id} style={{ borderRadius: 14, padding: 14, borderWidth: 1, borderColor: step.completed ? '#BBF7D0' : '#E5E7EB', backgroundColor: step.completed ? '#F0FDF4' : '#FAFAFA' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: step.completed ? colours.success : '#E5E7EB', alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontWeight: '900', color: step.completed ? colours.primaryText : '#6B7280', fontSize: 13 }}>{step.completed ? 'v' : i + 1}</Text>
            </View>
            <Text style={{ fontWeight: '900', fontSize: 16, flex: 1, color: step.completed ? '#166534' : '#111', textDecorationLine: step.completed ? 'line-through' : 'none' }}>{step.title}</Text>
            {step.completed && <View style={{ backgroundColor: '#BBF7D0', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 }}><Text style={{ fontSize: 11, fontWeight: '800', color: '#166534' }}>Done</Text></View>}
            {step.dismissed && !step.completed && <View style={{ backgroundColor: '#F3F4F6', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 }}><Text style={{ fontSize: 11, fontWeight: '800', color: '#9CA3AF' }}>Skipped</Text></View>}
          </View>

          <Text style={{ color: '#374151', fontSize: 14, marginBottom: 10 }}>{step.description}</Text>

          <View style={{ backgroundColor: '#FEF3C7', borderRadius: 10, padding: 10, marginBottom: 12, borderWidth: 1, borderColor: '#FDE68A' }}>
            <Text style={{ color: '#92400E', fontSize: 12, fontWeight: '700', marginBottom: 2 }}>Tip</Text>
            <Text style={{ color: '#92400E', fontSize: 13 }}>{step.tip}</Text>
          </View>

          {!step.completed && (
            <TouchableOpacity onPress={() => onAction(step)} style={{ backgroundColor: '#1D4ED8', padding: 13, borderRadius: 10, alignItems: 'center' }}>
              <Text style={{ color: '#fff', fontWeight: '900' }}>{step.action}</Text>
            </TouchableOpacity>
          )}
        </View>
      ))}

      <TouchableOpacity onPress={onReset} style={{ alignItems: 'center', padding: 12 }}>
        <Text style={{ color: '#9CA3AF', fontSize: 13 }}>Reset guide progress</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

export default withErrorBoundary(SetupGuideScreen, 'SetupGuide');
