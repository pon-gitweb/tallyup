// @ts-nocheck
// Compatibility wrapper so the Dashboard's existing "Reports" route
// shows the new ReportsIndexScreen without changing navigation.
import React from 'react';
import ReportsIndexScreen from './ReportsIndexScreen';

const dlog = (...a:any[]) => { if (__DEV__) console.log('[TallyUp Reports] mount (hub)', ...a); };

export default function ReportsScreenCompat(props:any) {
  dlog('props', Object.keys(props || {}));
  return <ReportsIndexScreen {...props} />;
}
