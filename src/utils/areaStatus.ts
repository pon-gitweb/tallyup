export function getAreaStatus(area: any) {
  const started = !!area?.startedAt;
  const completed = !!area?.completedAt;
  if (completed) return { text: 'Completed', hue: 'green' };
  if (started) return { text: 'In Progress', hue: 'orange' };
  return { text: 'Not Started', hue: 'gray' };
}
