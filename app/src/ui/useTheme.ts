import { useEffect, useState } from 'react';

/** Colours of the page and the map: follow the system (auto), force day or night, or red for the helm at night
 *  (keeps night vision: no white or blue light). */
export type Theme = 'auto' | 'day' | 'night' | 'helm';
export const THEME_KEY = 'interway.theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

function loadTheme(): Theme {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'day' || v === 'night' || v === 'helm' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

export function useTheme(win: Window = window) {
  const [theme, setTheme] = useState<Theme>(loadTheme);
  const [systemDark, setSystemDark] = useState(() => win.matchMedia?.(DARK_QUERY).matches ?? false);
  useEffect(() => {
    const mq = win.matchMedia?.(DARK_QUERY);
    if (!mq) return;
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [win]);
  useEffect(() => {
    // the stylesheet reads data-theme; without it, prefers-color-scheme decides
    if (theme === 'auto') win.document.documentElement.removeAttribute('data-theme');
    else win.document.documentElement.setAttribute('data-theme', theme);
    try {
      if (theme === 'auto') localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, theme);
    } catch {
      // storage blocked: the choice lasts for this visit
    }
  }, [theme, win]);
  return { theme, setTheme, night: theme === 'night' || theme === 'helm' || (theme === 'auto' && systemDark) };
}
