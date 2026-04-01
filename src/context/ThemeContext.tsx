// @ts-nocheck
/**
 * ThemeContext — Hosti-Stock Design System
 * Single source of truth for colours, typography, spacing.
 * Stored in Firestore per venue — persists across sessions.
 * User-customisable from Settings → Appearance.
 */
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { getFirestore } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type ThemeColours = {
  primary: string;        // Main brand colour — buttons, active states
  primaryLight: string;   // Light tint of primary — backgrounds
  primaryText: string;    // Text on primary backgrounds
  accent: string;         // Secondary accent — highlights
  background: string;     // App background
  surface: string;        // Card/surface background
  border: string;         // Border colour
  text: string;           // Primary text
  textSecondary: string;  // Secondary/muted text
  success: string;        // Green — positive states
  warning: string;        // Amber — warnings
  error: string;          // Red — errors
  danger: string;         // Red — destructive actions
};

export type ThemeConfig = {
  colours: ThemeColours;
  logoUri?: string | null;    // Venue logo URI (local or remote)
  venueName?: string | null;  // Shown in header/reports
  fontScale: number;          // 1.0 = default, 0.9 = compact, 1.1 = large
  cardRadius: number;         // Border radius for cards (default 14)
  density: 'comfortable' | 'compact' | 'spacious';
};

export const DEFAULT_COLOURS: ThemeColours = {
  primary: '#0F172A',       // Deep navy — professional, hospitality
  primaryLight: '#EFF6FF',  // Light blue tint
  primaryText: '#FFFFFF',
  accent: '#2563EB',        // Blue accent
  background: '#F8FAFC',    // Off-white background
  surface: '#FFFFFF',       // Pure white cards
  border: '#E2E8F0',        // Subtle border
  text: '#0F172A',          // Near-black text
  textSecondary: '#64748B', // Slate grey
  success: '#16A34A',
  warning: '#D97706',
  error: '#DC2626',
  danger: '#DC2626',
};

export const PRESET_THEMES: { name: string; colours: Partial<ThemeColours> }[] = [
  { name: 'Midnight (Default)', colours: { primary: '#0F172A', accent: '#2563EB' } },
  { name: 'Forest', colours: { primary: '#14532D', accent: '#16A34A', primaryLight: '#F0FDF4' } },
  { name: 'Slate', colours: { primary: '#334155', accent: '#0EA5E9', primaryLight: '#F0F9FF' } },
  { name: 'Burgundy', colours: { primary: '#7F1D1D', accent: '#B91C1C', primaryLight: '#FEF2F2' } },
  { name: 'Charcoal', colours: { primary: '#1C1917', accent: '#78716C', primaryLight: '#F5F5F4' } },
  { name: 'Ocean', colours: { primary: '#0C4A6E', accent: '#0284C7', primaryLight: '#F0F9FF' } },
];

export const DEFAULT_THEME: ThemeConfig = {
  colours: DEFAULT_COLOURS,
  logoUri: null,
  venueName: null,
  fontScale: 1.0,
  cardRadius: 14,
  density: 'comfortable',
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
  const db = getFirestore();

  const load = useCallback(async () => {
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
  return useContext(ThemeContext).theme.colours;
}
