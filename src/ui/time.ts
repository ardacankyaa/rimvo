export function formatMediaTime(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  // Work in whole hundredths so a value such as 59.999 never renders as "00:60.00".
  const hundredths = Math.floor(safe * 100 + 1e-6);
  const minutes = Math.floor(hundredths / 6000);
  const remainder = (hundredths % 6000) / 100;
  return minutes.toString().padStart(2, '0') + ':' + remainder.toFixed(2).padStart(5, '0');
}
