import React from 'react';
import AppNavigator from './src/navigation/AppNavigator';
import './src/services/firebase'; // ensure Firebase is initialized (RN persistence)

export default function App() {
  return <AppNavigator />;
}
