// Pure decision logic for trialReminderEmail, kept separate so it can be unit tested.
//
// Eligibility depends only on elapsed milliseconds since trial.startedAt and on
// stocktakesUsed. It never uses calendar days or UTC midnight, so the time of day
// the job runs (and its time zone) can't change who qualifies. It only changes
// when they're picked up. reminderSentAt makes the send one-shot.

export const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
export const EIGHT_DAYS_MS = 8 * 24 * 60 * 60 * 1000;

export interface TrialReminderInput {
  status?: string;
  reminderSentAt?: unknown;
  startMs: number;
  stocktakesUsed: number;
}

export function shouldSendTrialReminder(trial: TrialReminderInput, nowMs: number): boolean {
  if (trial.status !== "active") return false;
  if (trial.reminderSentAt) return false; // already sent
  const nearStocktakeLimit = trial.stocktakesUsed === 2;
  const nearTimeLimit = nowMs >= trial.startMs + THIRTY_DAYS_MS - EIGHT_DAYS_MS;
  return nearStocktakeLimit || nearTimeLimit;
}
