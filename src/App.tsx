import './polyfills/firestorePaths'
import React from 'react';
import RootNavigator from './navigation/RootNavigator';
import { VenueProvider } from './context/VenueProvider';
import { ToastProvider } from './components/common/Toast';

export default function App() {
  console.log('[TallyUp App] mount');
  return (
    <ToastProvider>
      <VenueProvider>
        <RootNavigator />
      </VenueProvider>
    </ToastProvider>
  );
}
