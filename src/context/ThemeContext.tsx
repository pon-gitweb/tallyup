// @ts-nocheck
/**
 * ThemeContext — Hosti Design System
 * Single source of truth for colours, typography, spacing.
 * Stored in Firestore per venue — persists across sessions.
 * User-customisable from Settings → Appearance.
 */
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';
import { useFonts, PlayfairDisplay_400Regular, PlayfairDisplay_500Medium, PlayfairDisplay_400Regular_Italic, PlayfairDisplay_700Bold } from '@expo-google-fonts/playfair-display';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';

export type ThemeColours = {
  primary: string;        // Action colour — buttons, active states
  primaryLight: string;   // Light tint of primary — backgrounds
  primaryText: string;    // Text on primary backgrounds
  accent: string;         // Secondary accent
  background: string;     // App background (brand: oat #f5f3ee)
  surface: string;        // Card/surface background
  border: string;         // Border colour
  text: string;           // Primary text
  textSecondary: string;  // Secondary/muted text
  success: string;        // Green — positive states
  warning: string;        // Amber — required fields and AI nudges only (#c47b2b)
  error: string;          // Red — errors
  danger: string;         // Red — destructive actions
  // Named brand tokens — use these directly for semantic clarity
  cream: string;          // #f5f3ee — background fill (Oat)
  teal: string;           // #1b4f72 — depth/link colour only
  amber: string;          // #c47b2b — required fields, AI nudges
  navy: string;           // Mission Slate — headings, nav, body text
  // Extended palette
  missionSlate: string;   // #3b3f4a — primary neutral-dark
  stellarAmber: string;   // #c47b2b — warm accent
  deepBlue: string;       // #1b4f72 — link/depth
  oat: string;            // #f5f3ee — background
  slateMid: string;       // #6b7280 — muted text
  oatMuted: string;       // #c9c5bd — muted border/divider
  positiveSoft: string;   // #e6f3ec — positive background tint
  positiveStrong: string; // #2f9e5d — positive foreground
  negativeSoft: string;   // #fce8e0 — negative background tint
  negativeStrong: string; // #d45b44 — negative foreground
  terracotta: string;     // #d45b44 — warm negative/alert
  surfaceDark: string;    // #3b3f4a — dark surface (nav, headers)
  borderStrong: string;   // #d8d3c6 — stronger border
};

export type ThemeConfig = {
  colours: ThemeColours;
  logoUri?: string | null;    // Venue logo URI (local or remote)
  venueName?: string | null;  // Shown in header/reports
  fontScale: number;          // 1.0 = default, 0.9 = compact, 1.1 = large
  cardRadius: number;         // Border radius for cards (default 14)
  density: 'comfortable' | 'compact' | 'spacious';
  // Typography — swap from 'System' once @expo-google-fonts are installed:
  //   npx expo install @expo-google-fonts/playfair-display @expo-google-fonts/inter
  //   then load PlayfairDisplay_700Bold + Inter_400Regular at app entry
  fontTitle: string;      // Playfair Display 500 Medium — section headers, labels
  fontTitleBold: string;  // Playfair Display 700 Bold — screen titles, hero numbers, big moments
  fontBody: string;           // Inter 400 — body copy, labels, inputs
  fontBodyMedium: string;     // Inter 500 — subheadings, secondary labels
  fontBodySemiBold: string;   // Inter 600 — buttons, emphasis
  fontBodyBold: string;       // Inter 700 — strong emphasis, chips
};

export const DEFAULT_COLOURS: ThemeColours = {
  primary: '#3b3f4a',       // Mission Slate — primary action colour
  primaryLight: '#ece8de',  // Warm muted tint
  primaryText: '#f5f3ee',   // Oat — text on dark/primary backgrounds
  accent: '#3b3f4a',        // Mission Slate — aligned with primary
  background: '#f5f3ee',    // Oat — app background
  surface: '#fbfaf6',       // Slightly raised card surface
  border: '#e7e3da',        // Soft Oat-tone border
  text: '#3b3f4a',          // Mission Slate — headings and body
  textSecondary: '#6b7280', // Slate Mid
  success: '#2f9e5d',       // Positive Green
  warning: '#c47b2b',       // Stellar Amber — required fields and AI nudges
  error: '#b91c1c',         // Critical Red
  danger: '#b91c1c',        // Critical Red — alias in sync
  // Named brand tokens
  cream: '#f5f3ee',         // Oat — background fill
  teal: '#1b4f72',          // Deep Blue — link/depth only
  amber: '#c47b2b',         // Stellar Amber
  navy: '#3b3f4a',          // Mission Slate — headings, nav, body
  // Extended palette
  missionSlate: '#3b3f4a',
  stellarAmber: '#c47b2b',
  deepBlue: '#1b4f72',
  oat: '#f5f3ee',
  slateMid: '#6b7280',
  oatMuted: '#c9c5bd',
  positiveSoft: '#e6f3ec',
  positiveStrong: '#2f9e5d',
  negativeSoft: '#fce8e0',
  negativeStrong: '#d45b44',
  terracotta: '#d45b44',
  surfaceDark: '#3b3f4a',
  borderStrong: '#d8d3c6',
};

export const PRESET_THEMES: { name: string; colours: Partial<ThemeColours> }[] = [
  { name: 'Hosti (Default)', colours: { primary: '#3b3f4a', accent: '#3b3f4a', background: '#f5f3ee', surface: '#fbfaf6' } },
  { name: 'Midnight', colours: { primary: '#0F172A', accent: '#2563EB', background: '#F8FAFC', surface: '#FFFFFF' } },
  { name: 'Forest', colours: { primary: '#14532D', accent: '#16A34A', primaryLight: '#F0FDF4', background: '#f5f3ee', surface: '#faf9f6' } },
  { name: 'Slate', colours: { primary: '#334155', accent: '#0EA5E9', primaryLight: '#F0F9FF', background: '#f5f3ee', surface: '#faf9f6' } },
  { name: 'Burgundy', colours: { primary: '#7F1D1D', accent: '#B91C1C', primaryLight: '#FEF2F2', background: '#f5f3ee', surface: '#faf9f6' } },
  { name: 'Ocean', colours: { primary: '#0C4A6E', accent: '#0284C7', primaryLight: '#F0F9FF', background: '#f5f3ee', surface: '#faf9f6' } },
];

export const DEFAULT_THEME: ThemeConfig = {
  colours: DEFAULT_COLOURS,
  logoUri: null,
  venueName: null,
  fontScale: 1.0,
  cardRadius: 14,
  density: 'comfortable',
  fontTitle: 'System',       // → 'PlayfairDisplay_500Medium' when fonts load
  fontTitleBold: 'System',   // → 'PlayfairDisplay_700Bold' when fonts load
  fontBody: 'System',        // → 'Inter_400Regular' when fonts load
  fontBodyMedium: 'System',  // → 'Inter_500Medium' when fonts load
  fontBodySemiBold: 'System',// → 'Inter_600SemiBold' when fonts load
  fontBodyBold: 'System',    // → 'Inter_700Bold' when fonts load
};

const CACHE_KEY = '@hosti_theme';

type ThemeContextValue = {
  theme: ThemeConfig;
  updateTheme: (patch: Partial<ThemeConfig>) => Promise<void>;
  updateColours: (patch: Partial<ThemeColours>) => Promise<void>;
  resetTheme: () => Promise<void>;
  isLoading: boolean;
  fontsLoaded: boolean;
};

const ThemeContext = createContext<ThemeContextValue>({
  theme: DEFAULT_THEME,
  updateTheme: async () => {},
  updateColours: async () => {},
  resetTheme: async () => {},
  isLoading: true,
  fontsLoaded: false,
});

export function ThemeProvider({ venueId, children }: { venueId: string | null; children: React.ReactNode }) {
  const [theme, setTheme] = useState<ThemeConfig>(DEFAULT_THEME);
  const [isLoading, setIsLoading] = useState(true);
  const loadingRef = React.useRef(false);
  const db = getFirestore();
  const [fontsLoaded] = useFonts({
    PlayfairDisplay_400Regular,
    PlayfairDisplay_500Medium,
    PlayfairDisplay_400Regular_Italic,
    PlayfairDisplay_700Bold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });
  const effectiveTheme = React.useMemo(
    () => ({
      ...theme,
      fontTitle:       fontsLoaded ? 'PlayfairDisplay_500Medium' : 'System',
      fontTitleBold:   fontsLoaded ? 'PlayfairDisplay_700Bold'   : 'System',
      fontBody:        fontsLoaded ? 'Inter_400Regular'          : 'System',
      fontBodyMedium:  fontsLoaded ? 'Inter_500Medium'           : 'System',
      fontBodySemiBold:fontsLoaded ? 'Inter_600SemiBold'         : 'System',
      fontBodyBold:    fontsLoaded ? 'Inter_700Bold'             : 'System',
    }),
    [theme, fontsLoaded]
  );

  const load = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      // Load from cache first for instant render
      const cached = await AsyncStorage.getItem(CACHE_KEY);
      if (cached) setTheme(JSON.parse(cached));

      // Then load from Firestore if venue exists
      if (venueId) {
        const snap = await getDoc(doc(db, 'venues', venueId, 'settings', 'theme'));
        if (snap.exists()) {
          const data = snap.data() as ThemeConfig;
          const merged = { ...DEFAULT_THEME, ...data, colours: { ...DEFAULT_COLOURS, ...data.colours } };
          setTheme(merged);
          await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(merged));
        }
      }
    } catch (e) {
      console.log('[ThemeContext] load error', e);
    } finally {
      setIsLoading(false);
      loadingRef.current = false;
    }
  }, [venueId]);

  useEffect(() => { load(); }, [load]);

  const save = useCallback(async (next: ThemeConfig) => {
    setTheme(next);
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(next));
    if (venueId) {
      try {
        await setDoc(doc(db, 'venues', venueId, 'settings', 'theme'), next, { merge: true });
      } catch {}
    }
  }, [venueId, db]);

  const updateTheme = useCallback(async (patch: Partial<ThemeConfig>) => {
    await save({ ...theme, ...patch });
  }, [theme, save]);

  const updateColours = useCallback(async (patch: Partial<ThemeColours>) => {
    await save({ ...theme, colours: { ...theme.colours, ...patch } });
  }, [theme, save]);

  const resetTheme = useCallback(async () => {
    await save(DEFAULT_THEME);
  }, [save]);

  return (
    <ThemeContext.Provider value={{ theme: effectiveTheme, updateTheme, updateColours, resetTheme, isLoading, fontsLoaded: !!fontsLoaded }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

// Convenience hook — just the colours
export function useColours(): ThemeColours {
  const ctx = useContext(ThemeContext);
  return ctx?.theme?.colours ?? DEFAULT_COLOURS;
}
