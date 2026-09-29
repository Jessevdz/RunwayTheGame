import { createContext, useContext } from 'react';

export type Theme = 'terminal' | 'night';

export interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  sunlight: boolean;
  setSunlight: (on: boolean) => void;
}

export const ThemeContext = createContext<ThemeContextValue>({
  theme: 'terminal',
  setTheme: () => {},
  toggleTheme: () => {},
  sunlight: false,
  setSunlight: () => {},
});

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
