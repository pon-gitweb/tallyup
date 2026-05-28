// ═══════════════════════════════════════════════════════════════════
// voiceCountingSession.ts
//
// Manages a hands-free voice counting session for stocktake areas.
//
// PHASE 1 (previous): Per-row mic button
//   → each product row had its own 🎤 tap to capture a count
//
// PHASE 2 (this file): Session-level mic
//   → one button activates voice mode for the whole area
//   → two-phase cycle: say product name, then say the count, repeat
//   → works with AirPods and Bluetooth earphones automatically —
//     Voice.start() uses whichever audio input the OS has active.
//     No code needed for audio routing.
//
// PHASE 3 (future):
//   → "undo" command — revert last saved count
//   → "correction" command — re-enter count for last product
//   → confidence scoring per recognition result
//   → auto-scroll to matched product row
//   → haptic feedback on match and save
// ═══════════════════════════════════════════════════════════════════

export type AreaItem = {
  id: string;
  name: string;
};

export type VoicePhase =
  | 'idle'     // voice mode off
  | 'product'  // listening for product name
  | 'count'    // listening for count number
  | 'confirm'  // multiple matches — awaiting selection
  | 'saving';  // writing count (brief confirmation state)

export type VoiceSessionState = {
  isActive: boolean;
  phase: VoicePhase;
  matchedItem: AreaItem | null;
  candidateItems: AreaItem[];
  lastSavedItem: string | null;
  lastSavedCount: number | null;
  bannerMessage: string;
  bannerColour: 'amber' | 'teal' | 'green' | 'terracotta' | 'hidden';
};

// ─── PRODUCT FUZZY MATCHING ───────────────────────────────────────────────────
//
// Priority chain (first match wins):
//   1. Exact name match (case insensitive)
//   2. First word match — "Heineken" → "Heineken 330ml"
//   3. Contains match — "scape" → "Scapegrace Black Gin"
//   4. All spoken words present in item name — "black gin" → "Scapegrace Black Gin"
//
// Returns array sorted by priority. Caller handles 0, 1, or many results.

export function matchProductByVoice(
  spoken: string,
  items: AreaItem[],
): AreaItem[] {
  const s = spoken.toLowerCase().trim();
  if (!s) return [];

  const exact = items.filter(i => i.name.toLowerCase() === s);
  if (exact.length > 0) return exact;

  const firstWord = s.split(' ')[0];
  const firstWordMatches = items.filter(i =>
    i.name.toLowerCase().startsWith(firstWord),
  );
  if (firstWordMatches.length === 1) return firstWordMatches;

  const contains = items.filter(i => i.name.toLowerCase().includes(s));
  if (contains.length > 0) return contains;

  const words = s.split(' ').filter(w => w.length > 2);
  if (words.length > 0) {
    const allWords = items.filter(i =>
      words.every(w => i.name.toLowerCase().includes(w)),
    );
    if (allWords.length > 0) return allWords;
  }

  return [];
}

// ─── VOICE COMMAND DETECTION ─────────────────────────────────────────────────
//
// Spoken commands that control the session rather than naming a product or count.
//
// end_session: "done" / "stop" / "finish" / "end" / "exit"
// skip:        "skip" / "next" / "pass"
// select_N:    "one" / "first" / "1" etc — used when multiple matches shown

export type VoiceCommand =
  | 'end_session'
  | 'skip'
  | 'select_1'
  | 'select_2'
  | 'select_3'
  | 'none';

export function detectVoiceCommand(spoken: string): VoiceCommand {
  const s = spoken.toLowerCase().trim();

  if (['done', 'stop', 'finish', 'end', 'exit'].includes(s)) return 'end_session';
  if (['skip', 'next', 'pass'].includes(s)) return 'skip';
  if (['one', 'first', '1'].includes(s)) return 'select_1';
  if (['two', 'second', '2'].includes(s)) return 'select_2';
  if (['three', 'third', '3'].includes(s)) return 'select_3';

  return 'none';
}

// ─── BANNER MESSAGES ─────────────────────────────────────────────────────────
//
// All user-facing copy for the voice session banner.
// Centralised here so copy can be updated without touching screen code.

export const VOICE_MESSAGES = {
  listening_product: 'Listening — say a product name',
  listening_count: (name: string) => `${name} — say the count`,
  multiple_matches: (count: number) =>
    `${count} matches — say one, two, or three`,
  not_found: 'Not found — say "skip" or try a different name',
  saved: (name: string, count: number) => `✓ ${name} — ${count} saved`,
  ended: 'Voice mode off',
};
