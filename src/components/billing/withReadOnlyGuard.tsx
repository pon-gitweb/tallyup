import React from 'react';
import { View } from 'react-native';
import {
  BillingState,
  isReadOnly,
  getTrialsLeft,
  TrialCounters,
} from '../../services/billing/entitlements';
import { ReadOnlyBanner } from './ReadOnlyBanner';

type GuardProps = {
  billing: BillingState;
  childrenWhenAllowed: React.ReactNode;
  onResubscribe?: () => void;
  allowIfTrial?: boolean;             // if certain actions can use trial counters
  trialKey?: keyof TrialCounters;     // which counter to consult when allowIfTrial = true
};

export function WithReadOnlyGuard({
  billing,
  childrenWhenAllowed,
  onResubscribe,
  allowIfTrial,
  trialKey,
}: GuardProps) {
  // Full access → always render
  if (!isReadOnly(billing)) return <>{childrenWhenAllowed}</>;

  // Read-only: allow through if trial is permitted and trials remain for this action
  if (allowIfTrial && trialKey) {
    const left = getTrialsLeft(billing, trialKey);
    if (left > 0) {
      return (
        <View>
          <ReadOnlyBanner
            onPress={onResubscribe}
            trialsLeftLabel={`Trial mode: ${left} ${left === 1 ? 'use' : 'uses'} left`}
          />
          {childrenWhenAllowed}
        </View>
      );
    }
  }

  // Otherwise block
  return (
    <View>
      <ReadOnlyBanner onPress={onResubscribe} />
    </View>
  );
}
