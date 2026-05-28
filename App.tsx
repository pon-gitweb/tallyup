import React from 'react';
import * as Sentry from '@sentry/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import RootNavigator from './src/navigation/RootNavigator';
import { VenueProvider } from './src/context/VenueProvider';
import AppErrorBoundary from './src/components/AppErrorBoundary';
import { initCrashReporting } from './src/services/crashReporting';

initCrashReporting();

function App() {
  console.log('[TallyUp App] mount');
  return (
    <SafeAreaProvider>
      <VenueProvider>
        <AppErrorBoundary>
          <RootNavigator />
        </AppErrorBoundary>
      </VenueProvider>
    </SafeAreaProvider>
  );
}

export default Sentry.wrap(App);
