import './polyfills/firestorePaths'
import React from 'react';
import RootNavigator from './navigation/RootNavigator';
import { VenueProvider } from './context/VenueProvider';

export default function App() {
  console.log('[TallyUp App] mount');
  return (
    <VenueProvider>
      <RootNavigator />
    </VenueProvider>
  );
}
