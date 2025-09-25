import { computeExpiresAt, computeReminderAt, DRAFT_TTL_DAYS, DRAFT_REMINDER_HOURS } from '../services/orderDrafts';

describe('orderDrafts time helpers', () => {
  it('computes expiresAt ~7 days ahead by default', () => {
    const now = new Date('2025-08-01T12:00:00Z');
    const exp = computeExpiresAt(now).toDate();
    const deltaDays = (exp.getTime() - now.getTime()) / (24*3600*1000);
    expect(Math.round(deltaDays)).toBe(DRAFT_TTL_DAYS);
  });

  it('computes reminderAt ~24 hours ahead by default', () => {
    const now = new Date('2025-08-01T12:00:00Z');
    const rem = computeReminderAt(now).toDate();
    const deltaHours = (rem.getTime() - now.getTime()) / (3600*1000);
    expect(Math.round(deltaHours)).toBe(DRAFT_REMINDER_HOURS);
  });
});
