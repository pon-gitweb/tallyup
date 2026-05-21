/**
 * parseSpokenCount — converts spoken text to a numeric count.
 * Pure function, no side effects.
 */
export function parseSpokenCount(text: string): number | null {
  const clean = (text || '').toLowerCase().trim().replace(/[.,!?]/g, '');

  if (!clean) return null;

  // Direct numeric
  const direct = parseFloat(clean);
  if (!isNaN(direct) && direct >= 0) return direct;

  // Simple word shortcuts
  if (clean === 'half') return 0.5;
  if (clean === 'quarter' || clean === 'a quarter') return 0.25;
  if (clean === 'zero' || clean === 'none') return 0;

  // "point five" → 0.5, "point two five" → 0.25
  const pointMatch = clean.match(/^point\s+(\w+(?:\s+\w+)?)$/);
  if (pointMatch) {
    const decStr = pointMatch[1].replace(/\s+/g, '');
    const dec = parseFloat('0.' + decStr);
    if (!isNaN(dec)) return dec;
  }

  // "X and a half" → X.5
  const halfMatch = clean.match(/^(\d+)\s+and\s+a\s+half$/);
  if (halfMatch) return parseInt(halfMatch[1], 10) + 0.5;

  // "X and a quarter" → X.25
  const quarterMatch = clean.match(/^(\d+)\s+and\s+a\s+quarter$/);
  if (quarterMatch) return parseInt(quarterMatch[1], 10) + 0.25;

  // Written word numbers
  const wordNumbers: Record<string, number> = {
    zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5,
    six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
    sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
    thirty: 30, forty: 40, fifty: 50, sixty: 60,
    seventy: 70, eighty: 80, ninety: 90, hundred: 100,
  };
  if (wordNumbers[clean] !== undefined) return wordNumbers[clean];

  // "twenty one", "thirty two" etc
  const parts = clean.split(/\s+/);
  if (parts.length === 2) {
    const tens = wordNumbers[parts[0]];
    const units = wordNumbers[parts[1]];
    if (tens !== undefined && units !== undefined && tens >= 20 && units < 10) {
      return tens + units;
    }
  }

  return null;
}
