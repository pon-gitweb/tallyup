import React from 'react';
import RootNavigator from './src/navigation/RootNavigator';
import { VenueProvider } from './src/context/VenueProvider';
import AppErrorBoundary from './src/components/AppErrorBoundary';

export default function App() {
  console.log('[TallyUp App] mount');
  return (
    <VenueProvider>
      <AppErrorBoundary>
        <RootNavigator />
      </AppErrorBoundary>
    </VenueProvider>
  );
}
