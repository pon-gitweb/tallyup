export function formatNZD(value: number): string {
  try {
    return new Intl.NumberFormat('en-NZ', {
      style: 'currency',
      currency: 'NZD',
      maximumFractionDigits: 2,
    }).format(value || 0);
  } catch {
    // Fallback if Intl isn’t available for some reason
    const n = Math.round((Number(value) || 0) * 100) / 100;
    return `NZ$${n.toFixed(2)}`;
  }
}
