import { createAudioEngine } from '../audio/public';
import { cancelAllGestures } from '../ui/gesture-registry';
export const engine = createAudioEngine({defaultPitchMode:'independent'});
export const subscribe = (listener: () => void) => engine.subscribe(listener);
export const getSnapshot = () => engine.getSnapshot();
const onPageHide = (event: PageTransitionEvent) => {
  cancelAllGestures();
  if (event.persisted) void engine.suspend().catch(() => undefined);
  else void engine.dispose().catch(() => undefined);
};
window.addEventListener('pagehide', onPageHide);
if (import.meta.hot) import.meta.hot.dispose(() => {
  window.removeEventListener('pagehide', onPageHide);
  cancelAllGestures();
  void engine.dispose().catch(() => undefined);
});
