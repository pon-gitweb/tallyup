// @ts-nocheck
// Compatibility wrapper so the Dashboard's existing "Reports" route
// renders the full Reports hub you already built.
import React from 'react';
import ReportsIndexScreen from './ReportsIndexScreen';

export default function ReportsScreen(props: any) {
  return <ReportsIndexScreen {...props} />;
}
