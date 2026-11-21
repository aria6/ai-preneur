import { useCallback, useSyncExternalStore } from 'react';

/** Reactive `window.matchMedia(query).matches`. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const media = window.matchMedia(query);
      media.addEventListener('change', onChange);
      return () => media.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);
}

/** Tailwind `md` (≥768px): tablet and up. */
export const useIsTabletUp = () => useMediaQuery('(min-width: 768px)');
/** Tailwind `lg` (≥1024px): desktop. */
export const useIsDesktop = () => useMediaQuery('(min-width: 1024px)');
