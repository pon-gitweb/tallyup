// Simple date helpers for period prompts (device-local time).
// We treat NZ as the primary timezone for copy; logic works in local time.
// No external deps; pure TS/JS.

function pad(n: number) { return String(n).padStart(2, '0'); }
function fmt(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

export function endOfMonth(base?: Date): Date {
  const now = base ? new Date(base) : new Date();
  const d = new Date(now.getFullYear(), now.getMonth() + 1, 0); // last day of current month
  d.setHours(23,59,59,999);
  return d;
}

export function endOfQuarter(base?: Date): Date {
  const now = base ? new Date(base) : new Date();
  const q = Math.floor(now.getMonth() / 3); // 0..3
  const endMonth = (q + 1) * 3 - 1; // 2,5,8,11
  const d = new Date(now.getFullYear(), endMonth + 1, 0); // last day of endMonth
  d.setHours(23,59,59,999);
  return d;
}

export function endOfYear(base?: Date): Date {
  const now = base ? new Date(base) : new Date();
  const d = new Date(now.getFullYear(), 11, 31);
  d.setHours(23,59,59,999);
  return d;
}

export function daysUntil(target: Date, base?: Date): number {
  const now = base ? new Date(base) : new Date();
  const ms = target.getTime() - now.getTime();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

export type PeriodPrompt = {
  eomDateStr: string;
  eoqDateStr: string;
  eoyDateStr: string;
  nearEOM: boolean;
  nearEOQ: boolean;
  nearEOY: boolean;
  daysToEOM: number;
  daysToEOQ: number;
  daysToEOY: number;
};

export function getPeriodPrompts(base?: Date): PeriodPrompt {
  const eom = endOfMonth(base);
  const eoq = endOfQuarter(base);
  const eoy = endOfYear(base);
  const dEOM = daysUntil(eom, base);
  const dEOQ = daysUntil(eoq, base);
  const dEOY = daysUntil(eoy, base);
  return {
    eomDateStr: fmt(eom),
    eoqDateStr: fmt(eoq),
    eoyDateStr: fmt(eoy),
    nearEOM: dEOM <= 5,   // show stronger prompt within 5 days
    nearEOQ: dEOQ <= 10,  // show stronger prompt within 10 days
    nearEOY: dEOY <= 20,  // show stronger prompt within 20 days
    daysToEOM: dEOM,
    daysToEOQ: dEOQ,
    daysToEOY: dEOY,
  };
}
