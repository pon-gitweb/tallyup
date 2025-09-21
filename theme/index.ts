import { lightColors } from "./colors";
import { spacing, radius } from "./spacing";
import { typography } from "./typography";

export type Theme = {
  colors: typeof lightColors;
  spacing: typeof spacing;
  radius: typeof radius;
  typography: typeof typography;
};

export const defaultTheme: Theme = {
  colors: lightColors,
  spacing,
  radius,
  typography,
};
