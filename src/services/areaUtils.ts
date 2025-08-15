export function statusColor(status: 'not_started' | 'in_progress' | 'complete') {
  if (status === 'complete') return '#D9FBE4';
  if (status === 'in_progress') return '#FFE8C2';
  return '#F0F0F0';
}
