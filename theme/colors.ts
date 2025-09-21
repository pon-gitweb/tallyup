export const palette = {
  navy: "#0B132B",
  teal: "#3A9D9E",
  gold: "#F0C808",
  white: "#FFFFFF",
  gray50: "#F5F6FA",
  gray300: "#D1D5DB",
  gray600: "#4B5563",
  success: "#2ECC71",
  warning: "#F39C12",
  danger:  "#E74C3C",
};

export type AppColors = {
  background: string;
  surface: string;
  text: string;
  mutedText: string;
  primary: string;
  secondary: string;
  accent: string;
  success: string;
  warning: string;
  danger: string;
  border: string;
};

export const lightColors: AppColors = {
  background: palette.white,
  surface: palette.gray50,
  text: palette.navy,
  mutedText: palette.gray600,
  primary: palette.navy,
  secondary: palette.teal,
  accent: palette.gold,
  success: palette.success,
  warning: palette.warning,
  danger: palette.danger,
  border: palette.gray300,
};
