// @ts-nocheck
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Text, TouchableOpacity, View } from 'react-native';
import { GuideState, GuideStep, dismissStep, dismissGuide, getNextIncompleteStep, getCompletedCount, loadGuideState, markStepComplete } from '../../services/guide/SetupGuideService';

type Props = { onNavigate: (route: string, params?: any) => void };

export default function SetupGuideBanner({ onNavigate }: Props) {
  const [state, setState] = useState<GuideState | null>(null);
  const [expanded, setExpanded] = useState(true);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const load = useCallback(async () => {
    const s = await loadGuideState();
    setState(s);
    Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }).start();
  }, []);

  useEffect(() => { load(); }, []);

  const onDismissStep = useCallback(async (step: GuideStep) => { await dismissStep(step.id); load(); }, [load]);
  const onDismissAll = useCallback(async () => { await dismissGuide(); load(); }, [load]);
  const onAction = useCallback(async (step: GuideStep) => { await markStepComplete(step.id); onNavigate(step.actionRoute, step.actionParams); load(); }, [onNavigate, load]);

  if (!state || state.guideFullyDismissed) return null;

  const nextStep = getNextIncompleteStep(state.steps);
  const completed = getCompletedCount(state.steps);
  const total = state.steps.length;
  const pct = Math.round((completed / total) * 100);

  if (!nextStep) {
    return (
      <Animated.View style={{ opacity: fadeAnim, margin: 12, backgroundColor: '#F0FDF4', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#BBF7D0' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: '900', color: '#166534', fontSize: 15 }}>Setup complete!</Text>
            <Text style={{ color: '#166534', fontSize: 13, marginTop: 2 }}>You are all set — Hosti-Stock is ready to go.</Text>
          </View>
          <TouchableOpacity onPress={onDismissAll} style={{ padding: 8 }}>
            <Text style={{ color: '#166534', fontWeight: '700' }}>X</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    );
  }

  return (
    <Animated.View style={{ opacity: fadeAnim, margin: 12, backgroundColor: '#EFF6FF', borderRadius: 14, borderWidth: 1, borderColor: '#BFDBFE' }}>
      <TouchableOpacity onPress={() => setExpanded(e => !e)} style={{ padding: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <Text style={{ fontWeight: '900', color: '#1D4ED8', fontSize: 14 }}>Setup guide</Text>
            <View style={{ backgroundColor: '#DBEAFE', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 }}>
              <Text style={{ fontSize: 11, fontWeight: '800', color: '#1D4ED8' }}>{completed}/{total} done</Text>
            </View>
          </View>
          <View style={{ height: 4, backgroundColor: '#BFDBFE', borderRadius: 2, overflow: 'hidden' }}>
            <View style={{ height: 4, width: pct + '%', backgroundColor: '#2563EB', borderRadius: 2 }} />
          </View>
        </View>
        <Text style={{ color: '#1D4ED8', marginLeft: 8, fontSize: 16 }}>{expanded ? 'v' : '>'}</Text>
      </TouchableOpacity>

      {expanded && (
        <View style={{ paddingHorizontal: 14, paddingBottom: 14, gap: 12 }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#BFDBFE' }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <Text style={{ fontWeight: '900', color: '#111', fontSize: 15, flex: 1 }}>{nextStep.title}</Text>
              <TouchableOpacity onPress={() => onDismissStep(nextStep)} style={{ padding: 4 }}>
                <Text style={{ color: '#9CA3AF', fontWeight: '700' }}>Skip</Text>
              </TouchableOpacity>
            </View>
            <Text style={{ color: '#374151', fontSize: 13, marginTop: 6 }}>{nextStep.description}</Text>
            <View style={{ backgroundColor: '#FEF3C7', borderRadius: 10, padding: 10, marginTop: 10, borderWidth: 1, borderColor: '#FDE68A' }}>
              <Text style={{ color: '#92400E', fontSize: 12, fontWeight: '700', marginBottom: 2 }}>Tip</Text>
              <Text style={{ color: '#92400E', fontSize: 12 }}>{nextStep.tip}</Text>
            </View>
            <TouchableOpacity onPress={() => onAction(nextStep)} style={{ backgroundColor: '#1D4ED8', padding: 12, borderRadius: 10, alignItems: 'center', marginTop: 12 }}>
              <Text style={{ color: '#fff', fontWeight: '900' }}>{nextStep.action}</Text>
            </TouchableOpacity>
          </View>

          <View style={{ gap: 6 }}>
            {state.steps.map((step, i) => (
              <View key={step.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: step.completed ? '#2563EB' : '#DBEAFE', alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontSize: 11, fontWeight: '900', color: step.completed ? '#fff' : '#2563EB' }}>{step.completed ? 'v' : i + 1}</Text>
                </View>
                <Text style={{ fontSize: 13, flex: 1, color: step.completed ? '#6B7280' : '#111', textDecorationLine: step.completed ? 'line-through' : 'none', fontWeight: step.id === nextStep.id ? '800' : '400' }}>{step.title}</Text>
                {step.id === nextStep.id && (
                  <View style={{ backgroundColor: '#2563EB', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999 }}>
                    <Text style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>Next</Text>
                  </View>
                )}
              </View>
            ))}
          </View>

          <TouchableOpacity onPress={onDismissAll} style={{ alignItems: 'center', paddingVertical: 4 }}>
            <Text style={{ color: '#9CA3AF', fontSize: 12 }}>Hide guide (available in Settings anytime)</Text>
          </TouchableOpacity>
        </View>
      )}
    </Animated.View>
  );
}
