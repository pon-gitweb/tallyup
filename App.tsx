import './polyfills/firestorePaths'
import React from 'react';
import RootNavigator from './navigation/RootNavigator';
import { VenueProvider } from './context/VenueProvider';
import { ThemeProvider } from './theme/ThemeProvider';

export default function App() {
  console.log('[TallyUp App] mount');
  return (
    <ThemeProvider>
      <VenueProvider>
        <RootNavigator />
      </VenueProvider>
    </ThemeProvider>
  );
}
