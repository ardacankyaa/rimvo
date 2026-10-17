export function formatMediaTime(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const minutes = Math.floor(safe / 60);
  const remainder = safe - minutes * 60;
  return minutes.toString().padStart(2, '0') + ':' + remainder.toFixed(2).padStart(5, '0');
}
