import { useEffect } from 'react';

type GestureCleanup = () => void;
const active = new Map<symbol, GestureCleanup>();

export function registerGesture(cleanup: GestureCleanup): () => void {
  const token = Symbol('gesture');
  active.set(token, cleanup);
  return () => { active.delete(token); };
}

export function cancelAllGestures(): void {
  for (const [token, cleanup] of [...active]) {
    active.delete(token);
    cleanup();
  }
}

export function useGestureBlurCleanup(): void {
  useEffect(() => {
    const cancel = () => cancelAllGestures();
    const onVisibility = () => { if (document.visibilityState === 'hidden') cancel(); };
    window.addEventListener('blur', cancel);
    window.addEventListener('pagehide', cancel);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('blur', cancel);
      window.removeEventListener('pagehide', cancel);
      document.removeEventListener('visibilitychange', onVisibility);
      cancel();
    };
  }, []);
}
