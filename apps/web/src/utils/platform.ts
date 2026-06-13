export function isMacPlatform(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
}

/** Returns true when the page is running inside a Wails desktop shell. */
export function isWailsShell(): boolean {
  if (typeof window === 'undefined') return false;
  // Wails v3 exposes window.wails once its runtime bridge is initialised.
  // We cast to unknown to avoid needing a full type declaration.
  return (
    'wails' in window ||
    '__wails__' in window
  );
}
