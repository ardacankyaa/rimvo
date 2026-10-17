type VisualTask = (now: number) => void;

const tasks = new Set<VisualTask>();
let frame: number | null = null;
let listening = false;

function tick(now: number): void {
  frame = null;
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
  for (const task of [...tasks]) task(now);
  if (tasks.size && frame === null) frame = requestAnimationFrame(tick);
}
function onVisibilityChange(): void {
  if (typeof document === 'undefined') return;
  if (document.visibilityState === 'hidden') {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  } else if (tasks.size && frame === null) {
    frame = requestAnimationFrame(tick);
  }
}
function start(): void {
  if (typeof document !== 'undefined' && !listening) {
    document.addEventListener('visibilitychange', onVisibilityChange);
    listening = true;
  }
  if (typeof document === 'undefined' || document.visibilityState !== 'hidden') {
    if (frame === null) frame = requestAnimationFrame(tick);
  }
}

export function registerVisualTask(task: VisualTask): () => void {
  tasks.add(task);
  start();
  return () => {
    tasks.delete(task);
    if (!tasks.size) {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      if (listening && typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibilityChange);
      listening = false;
    }
  };
}

if (import.meta.hot) import.meta.hot.dispose(() => {
  if (frame !== null) cancelAnimationFrame(frame);
  frame = null;
  tasks.clear();
  if (listening && typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibilityChange);
  listening = false;
});
