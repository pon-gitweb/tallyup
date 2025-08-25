import React, { useMemo, useState } from 'react';
import { View, Text, Button, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import ProductsStep from './steps/ProductsStep';
import DepartmentsStep from './steps/DepartmentsStep';
import AreasStep from './steps/AreasStep';
import SuppliersStep from './steps/SuppliersStep';

import { setSetupCompleted } from '../../services/venueSetupFlag';
import { getCurrentVenueForUser } from '../../services/devBootstrap';

const STEPS = ['Products', 'Departments', 'Areas', 'Suppliers'] as const;
type StepKey = typeof STEPS[number];

export default function SetupWizard() {
  const nav = useNavigation<any>();
  const [idx, setIdx] = useState(0);
  const stepKey: StepKey = STEPS[idx];

  const stepEl = useMemo(() => {
    switch (stepKey) {
      case 'Products': return <ProductsStep />;
      case 'Departments': return <DepartmentsStep />;
      case 'Areas': return <AreasStep />;
      case 'Suppliers': return <SuppliersStep />;
      default: return null;
    }
  }, [stepKey]);

  async function onDone() {
    try {
      const venueId = await getCurrentVenueForUser();
      if (!venueId) {
        Alert.alert('No Venue', 'Please create a venue first.');
        return;
      }
      await setSetupCompleted(venueId, true);
      console.log('[TallyUp SetupWizard] setupCompleted true', JSON.stringify({ venueId }));
      Alert.alert('Setup Complete', 'Your venue setup is saved.');

      // Return to Dashboard
      nav.reset({ index: 0, routes: [{ name: 'Dashboard' }] });
    } catch (e: any) {
      console.log('[TallyUp SetupWizard] done error', JSON.stringify({ code: e?.code, message: e?.message }));
      Alert.alert('Save Failed', e?.message ?? 'Unknown error.');
    }
  }

  return (
    <View style={{ flex: 1, padding: 16, gap: 12 }}>
      <Text style={{ fontSize: 22, fontWeight: '700' }}>Venue Setup</Text>
      <Text style={{ opacity: 0.7 }}>Step {idx + 1} of {STEPS.length}: {stepKey}</Text>

      <View style={{ flex: 1 }}>
        {stepEl}
      </View>

      <View style={{ flexDirection: 'row', gap: 12, justifyContent: 'space-between' }}>
        <Button title="Back" onPress={() => setIdx(Math.max(0, idx - 1))} disabled={idx === 0} />
        {idx < STEPS.length - 1
          ? <Button title="Next" onPress={() => setIdx(Math.min(STEPS.length - 1, idx + 1))} />
          : <Button title="Done" onPress={onDone} />
        }
      </View>
    </View>
  );
}
