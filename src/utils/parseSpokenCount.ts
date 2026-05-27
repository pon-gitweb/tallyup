/**
 * parseSpokenCount — converts spoken text to a numeric count.
 * Pure function, no side effects.
 */
export function parseSpokenCount(
  input: string
): number | null {
  if (!input) return null;
  const text = input.toLowerCase().trim();

  // Direct decimal or integer — try this first
  // Handles "1", "10", "100", "1.5", "12.5"
  const direct = parseFloat(text);
  if (!isNaN(direct) && direct >= 0) return direct;

  // "half" → 0.5
  if (text === 'half' || text === 'a half')
    return 0.5;

  // "quarter" or "a quarter" → 0.25
  if (text === 'quarter' || text === 'a quarter')
    return 0.25;

  // "point five", "point two five" etc
  const pointMatch = text.match(
    /^point\s+(\w+(?:\s+\w+)?)$/
  );
  if (pointMatch) {
    const afterPoint = wordsToNumber(pointMatch[1]);
    if (afterPoint !== null)
      return parseFloat(`0.${afterPoint}`);
  }

  // "X and a half" → X.5
  const halfMatch = text.match(
    /^(.+?)\s+and\s+a\s+half$/
  );
  if (halfMatch) {
    const base = parseSpokenCount(halfMatch[1]);
    if (base !== null) return base + 0.5;
  }

  // "X point Y" → X.Y
  const pointNumMatch = text.match(
    /^(.+?)\s+point\s+(.+)$/
  );
  if (pointNumMatch) {
    const whole = parseSpokenCount(pointNumMatch[1]);
    const decimal = wordsToNumber(pointNumMatch[2]);
    if (whole !== null && decimal !== null)
      return parseFloat(`${whole}.${decimal}`);
  }

  // Word numbers — handles up to 999
  const wordResult = wordsToNumber(text);
  if (wordResult !== null) return wordResult;

  return null;
}

// Converts word numbers to integer
// Handles: "one" through "nine hundred and ninety nine"
function wordsToNumber(text: string): number | null {
  const ones: Record<string, number> = {
    'zero': 0, 'one': 1, 'two': 2,
    'three': 3, 'four': 4, 'five': 5,
    'six': 6, 'seven': 7, 'eight': 8,
    'nine': 9, 'ten': 10, 'eleven': 11,
    'twelve': 12, 'thirteen': 13,
    'fourteen': 14, 'fifteen': 15,
    'sixteen': 16, 'seventeen': 17,
    'eighteen': 18, 'nineteen': 19
  };

  const tens: Record<string, number> = {
    'twenty': 20, 'thirty': 30,
    'forty': 40, 'fifty': 50,
    'sixty': 60, 'seventy': 70,
    'eighty': 80, 'ninety': 90
  };

  // Single word ones
  if (ones[text] !== undefined) return ones[text];

  // Single word tens
  if (tens[text] !== undefined) return tens[text];

  // "twenty one", "thirty five" etc
  // with or without hyphen
  const cleanText = text.replace(/-/g, ' ');
  const parts = cleanText.split(/\s+/);

  // Two word: "twenty one"
  if (parts.length === 2) {
    const t = tens[parts[0]];
    const o = ones[parts[1]];
    if (t !== undefined && o !== undefined)
      return t + o;
  }

  // Hundreds: "one hundred"
  if (parts.length === 2 &&
      ones[parts[0]] !== undefined &&
      parts[1] === 'hundred') {
    return ones[parts[0]] * 100;
  }

  // "one hundred and twenty"
  // "one hundred and twenty five"
  if (parts.length >= 3 &&
      ones[parts[0]] !== undefined &&
      parts[1] === 'hundred') {
    const hundredVal = ones[parts[0]] * 100;
    const remainder = parts
      .slice(parts[2] === 'and' ? 3 : 2)
      .join(' ');
    const remainderVal = wordsToNumber(remainder);
    if (remainderVal !== null)
      return hundredVal + remainderVal;
    return hundredVal;
  }

  // Try parseFloat as last resort
  const n = parseFloat(text);
  if (!isNaN(n)) return n;

  return null;
}
