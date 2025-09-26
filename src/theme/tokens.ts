/**
 * Design tokens for TallyUp V2 (Expo-safe; pure TS).
 * These are *not* wired yet. Consumers will import via ThemeProvider.
 */

export type ColorScale = {
  [k: number]: string;
};

export type BrandPalette = {
  primary: string;        // Brand primary (navy)
  primaryTextOn: string;  // Text color on primary surfaces
  accent: string;         // Accent (buttons/links)
  accentTextOn: string;
  success: string;
  successTextOn: string;
  warning: string;
  warningTextOn: string;
  danger: string;
  dangerTextOn: string;
  // neutrals
  bg: string;             // App background
  surface: string;        // Cards, sheets
  border: string;         // Hairlines
  text: string;           // Primary text
  textMuted: string;      // Secondary text
};

export const colors: BrandPalette = {
  // From MVP: navy splash background #0B132B
  primary: '#0B132B',
  primaryTextOn: '#FFFFFF',

  // Accent: iOS blue-ish used in screens
  accent: '#0A84FF',
  accentTextOn: '#FFFFFF',

  success: '#2E7D32',
  successTextOn: '#FFFFFF',

  warning: '#FF6F00',
  warningTextOn: '#000000',

  danger: '#D32F2F',
  dangerTextOn: '#FFFFFF',

  // Neutrals aligned with current screens
  bg: '#FFFFFF',
  surface: '#F7F7FA',
  border: '#E5E7EB',
  text: '#111827',
  textMuted: '#6B7280',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  '2xl': 32,
} as const;

export const radius = {
  sm: 8,
  md: 10,
  lg: 12,
  xl: 16,
  pill: 999,
} as const;

export const typography = {
  family: {
    // Expo default system fonts (safe)
    regular: 'System',
    medium: 'System',
    bold: 'System',
  },
  size: {
    xs: 12,
    sm: 14,
    md: 16,
    lg: 18,
    xl: 22,
    '2xl': 28,
  },
  lineHeight: {
    tight: 1.1,
    normal: 1.3,
    relaxed: 1.5,
  },
} as const;

export type Tokens = {
  colors: BrandPalette;
  spacing: typeof spacing;
  radius: typeof radius;
  typography: typeof typography;
};

export const tokens: Tokens = {
  colors,
  spacing,
  radius,
  typography,
};
