import type { ActiveSession } from 'src/services/activeTake';

export function primaryCtaLabel(session: ActiveSession | null) {
  if (!session) return 'Start Stock Take';
  if (session.status === 'active') return 'Return to Active Stock Take';
  if (session.status === 'completed') return 'Start New Stock Take';
  return 'Start Stock Take';
}
