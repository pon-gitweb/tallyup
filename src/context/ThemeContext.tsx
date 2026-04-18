// @ts-nocheck
/**
 * ThemeContext — Hosti-Stock Design System
 * Single source of truth for colours, typography, spacing.
 * Stored in Firestore per venue — persists across sessions.
 * User-customisable from Settings → Appearance.
 */
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';

export type ThemeColours = {
  primary: string;        // Action colour — buttons, active states (brand: teal #1b4f72)
  primaryLight: string;   // Light tint of primary — backgrounds
  primaryText: string;    // Text on primary backgrounds
  accent: string;         // Secondary accent (brand: teal #1b4f72)
  background: string;     // App background (brand: cream #f5f3ee)
  surface: string;        // Card/surface background
  border: string;         // Border colour
  text: string;           // Primary text (brand: navy #0B132B)
  textSecondary: string;  // Secondary/muted text
  success: string;        // Green — positive states
  warning: string;        // Amber — required fields and AI nudges only (#c47b2b)
  error: string;          // Red — errors
  danger: string;         // Red — destructive actions
  // Named brand tokens — use these directly for semantic clarity
  cream: string;          // #f5f3ee — background fill
  teal: string;           // #1b4f72 — single action colour
  amber: string;          // #c47b2b — required fields, AI nudges
  navy: string;           // #0B132B — headings, nav, body text
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
  fontTitle: string;          // Playfair Display — screen titles, section headers
  fontBody: string;           // Inter — body copy, labels, inputs
};

export const DEFAULT_COLOURS: ThemeColours = {
  primary: '#1b4f72',       // Teal — single action colour (buttons, active states)
  primaryLight: '#e8f2f9',  // Light teal tint
  primaryText: '#FFFFFF',
  accent: '#1b4f72',        // Teal accent
  background: '#f5f3ee',    // Cream — app background
  surface: '#faf9f6',       // Warm white — cards and sheets
  border: '#dcd9d2',        // Warm grey border
  text: '#0B132B',          // Navy — headings and body
  textSecondary: '#5c6b7a', // Muted navy-grey
  success: '#16A34A',
  warning: '#c47b2b',       // Amber — required fields and AI nudges
  error: '#DC2626',
  danger: '#DC2626',
  // Named brand tokens
  cream: '#f5f3ee',
  teal: '#1b4f72',
  amber: '#c47b2b',
  navy: '#0B132B',
};

export const PRESET_THEMES: { name: string; colours: Partial<ThemeColours> }[] = [
  { name: 'Hosti (Default)', colours: { primary: '#1b4f72', accent: '#1b4f72', background: '#f5f3ee', surface: '#faf9f6' } },
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
  fontTitle: 'System',  // → 'PlayfairDisplay_700Bold' once @expo-google-fonts/playfair-display is installed
  fontBody: 'System',   // → 'Inter_400Regular' once @expo-google-fonts/inter is installed
};

const CACHE_KEY = '@hosti_theme';

type ThemeContextValue = {
  theme: ThemeConfig;
  updateTheme: (patch: Partial<ThemeConfig>) => Promise<void>;
  updateColours: (patch: Partial<ThemeColours>) => Promise<void>;
  resetTheme: () => Promise<void>;
  isLoading: boolean;
};

const ThemeContext = createContext<ThemeContextValue>({
  theme: DEFAULT_THEME,
  updateTheme: async () => {},
  updateColours: async () => {},
  resetTheme: async () => {},
  isLoading: true,
});

export function ThemeProvider({ venueId, children }: { venueId: string | null; children: React.ReactNode }) {
  const [theme, setTheme] = useState<ThemeConfig>(DEFAULT_THEME);
  const [isLoading, setIsLoading] = useState(true);
  const loadingRef = React.useRef(false);
  const db = getFirestore();

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
    <ThemeContext.Provider value={{ theme, updateTheme, updateColours, resetTheme, isLoading }}>
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
