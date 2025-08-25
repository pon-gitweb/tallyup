import React from 'react';
import RootNavigator from './src/navigation/RootNavigator';
import { VenueProvider } from './src/context/VenueProvider';

export default function App() {
  console.log('[TallyUp App] mount');
  return (
    <VenueProvider>
      <RootNavigator />
    </VenueProvider>
  );
}
