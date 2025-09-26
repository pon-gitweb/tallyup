import React, { createContext, useContext, useMemo } from 'react';
import { tokens as defaultTokens, Tokens } from './tokens';

export type Theme = {
  mode: 'light';           // future-proof: add 'dark' later
  tokens: Tokens;
};

const ThemeContext = createContext<Theme>({
  mode: 'light',
  tokens: defaultTokens,
});

type Props = {
  children: React.ReactNode;
  value?: Partial<Theme>; // optional override for tests/future
};

export function ThemeProvider({ children, value }: Props) {
  const merged = useMemo<Theme>(() => {
    return {
      mode: value?.mode ?? 'light',
      tokens: value?.tokens ?? defaultTokens,
    };
  }, [value]);
  return <ThemeContext.Provider value={merged}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}
