type TelemetryType =
  | 'order.created'
  | 'order.submitted'
  | 'order.status'
  | 'payment.initiated'
  | 'payment.success'
  | 'payment.failed'
  | 'stocktake.started'
  | 'stocktake.completed'
  | 'trial.used'
  | 'trial.exhausted'
  | 'presence.updated';

interface TelemetryEvent {
  type: TelemetryType;
  venueId: string;
  ts: number;
  payload?: Record<string, unknown>;
}

// Replace with Firestore writes if desired; keep client safe.
export async function logEvent(evt: TelemetryEvent): Promise<void> {
  try {
    // Example: send to a Cloud Function endpoint or Firestore collection
    // await addDoc(collection(firestore, `venues/${evt.venueId}/telemetry`), evt)
    console.log('[telemetry]', evt.type, { ts: evt.ts, venue: evt.venueId, payload: evt.payload });
  } catch (e) {
    console.warn('[telemetry] failed', e);
  }
}

export function now(): number { return Date.now(); }
