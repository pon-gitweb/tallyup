
export type CycleLength = 'session' | 'daily' | 'weekly';

export interface CycleConfig {
  cycleLength: CycleLength;
  cycleLabel: string;
  cycleDescription: string;
  snapshotIntervalHours: number;
}

export function determineCycleLength(eventDurationDays: number): CycleLength {
  if (eventDurationDays <= 3) return 'session';
  if (eventDurationDays <= 14) return 'daily';
  return 'weekly';
}

export function getCycleConfig(cycleLength: CycleLength): CycleConfig {
  switch (cycleLength) {
    case 'session':
      return {
        cycleLength: 'session',
        cycleLabel: 'Per session',
        cycleDescription: 'Short event — snapshots taken each session (morning / afternoon / evening)',
        snapshotIntervalHours: 6,
      };
    case 'daily':
      return {
        cycleLength: 'daily',
        cycleLabel: 'Daily',
        cycleDescription: 'Multi-day event — one snapshot at the close of each day',
        snapshotIntervalHours: 24,
      };
    case 'weekly':
      return {
        cycleLength: 'weekly',
        cycleLabel: 'Weekly',
        cycleDescription: 'Long event — weekly snapshots with end-of-week reviews available',
        snapshotIntervalHours: 168,
      };
  }
}
