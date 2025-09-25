export function formatDateTime(dt: Date | number): string {
  const d = typeof dt === 'number' ? new Date(dt) : dt;
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);
}
