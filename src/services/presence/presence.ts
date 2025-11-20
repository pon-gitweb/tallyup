export interface PresenceState {
  active: boolean;
  screen?: string;
  areaId?: string;
  module?: string; // e.g., 'Stock', 'Orders'
  updatedAt: number;
}

// Stub: wire to Firestore/RTDB writes in real usage.
export async function setPresence(userId: string, venueId: string, p: PresenceState) {
  console.log('[presence] set', { userId, venueId, ...p });
}

export function buildPresence(screen: string, areaId?: string, module?: string): PresenceState {
  return { active: true, screen, areaId, module, updatedAt: Date.now() };
}
