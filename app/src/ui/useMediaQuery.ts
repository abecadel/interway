import { useEffect, useState } from 'react';

export const PHONE = '(max-width: 700px)';

export function useMediaQuery(query: string, win: Window = window): boolean {
  const [matches, setMatches] = useState(() => win.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const mq = win.matchMedia?.(query);
    if (!mq) return;
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query, win]);
  return matches;
}
